using System.Numerics;
using System.Runtime.InteropServices;
using Vortice.D3DCompiler;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;
using Vortice.Mathematics;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
using Windows.Graphics.DirectX.Direct3D11;
using Windows.UI.Composition;
using WinRT;

namespace IslandBackdrop;

/// <summary>
/// Интероп захвата экрана, D3D11 и Composition-swapchain.
/// </summary>
internal static class CaptureInterop
{
    public const uint WDA_EXCLUDEFROMCAPTURE = 0x00000011;
    public const uint MONITOR_DEFAULTTONEAREST = 2;

    public static readonly Guid GraphicsCaptureItemIid = new("79C3F95B-31F7-4EC2-A464-632EF5D30760");
    public static readonly Guid Texture2DIid = new("6f15aaf2-d208-4e89-9ab4-489535d34f9c");

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MONITORINFO
    {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
    }

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint dwAffinity);

    [DllImport("user32.dll")]
    public static extern IntPtr MonitorFromRect(ref RECT lprc, uint dwFlags);

    [DllImport("user32.dll")]
    public static extern bool GetMonitorInfoW(IntPtr hMonitor, ref MONITORINFO lpmi);

    [DllImport("d3d11.dll", EntryPoint = "CreateDirect3D11DeviceFromDXGIDevice", ExactSpelling = true)]
    public static extern int CreateDirect3D11DeviceFromDXGIDevice(IntPtr dxgiDevice, out IntPtr graphicsDevice);

    /// <summary>QI WinRT-объекта к COM-интерфейсу интеропа.</summary>
    public static T QueryComInterface<T>(IntPtr unknown) where T : class
    {
        var iid = typeof(T).GUID;
        var hr = Marshal.QueryInterface(unknown, ref iid, out var ptr);
        if (hr != 0 || ptr == IntPtr.Zero)
        {
            throw new InvalidOperationException($"QueryInterface {typeof(T).Name} hr=0x{hr:X8}");
        }
        try
        {
            return (T)Marshal.GetObjectForIUnknown(ptr);
        }
        finally
        {
            Marshal.Release(ptr);
        }
    }
}

[ComImport]
[Guid("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IGraphicsCaptureItemInterop
{
    IntPtr CreateForWindow([In] IntPtr window, [In] ref Guid iid);

    IntPtr CreateForMonitor([In] IntPtr monitor, [In] ref Guid iid);
}

[ComImport]
[Guid("A9B3D012-3DF2-4EE3-B8D1-8695F457D3C1")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IDirect3DDxgiInterfaceAccess
{
    IntPtr GetInterface([In] ref Guid iid);
}

[ComImport]
[Guid("25297D5C-3AD4-4C9C-B5CF-E36A38512330")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface ICompositorInterop
{
    IntPtr CreateCompositionSurfaceForHandle([In] IntPtr swapChain);

    IntPtr CreateCompositionSurfaceForSwapChain([In] IntPtr swapChain);

    IntPtr CreateGraphicsDevice([In] IntPtr renderingDevice);
}

/// <summary>Фигура для шейдера в пикселях окна подложки.</summary>
internal readonly record struct GlassShape(float X, float Y, float W, float H, float R);

/// <summary>Константы шейдера; раскладка совпадает с cbuffer P в HLSL.</summary>
[StructLayout(LayoutKind.Sequential)]
internal struct RefractionParams
{
    /// <summary>xy — левый верх окна в кадре захвата, zw — размер кадра</summary>
    public Vector4 Origin;
    public Vector4 Shape0;
    public Vector4 Shape1;
    public Vector4 Shape2;
    public Vector4 Shape3;
    public Vector4 Radii;
    /// <summary>x — число фигур, y — сила преломления px, z — ширина фаски px, w — тинт</summary>
    public Vector4 Optics;
    /// <summary>x — сила блика, y — вес кольца преломления, z — 1 для прозрачного стекла, w — дисперсия</summary>
    public Vector4 Light;
}

/// <summary>
/// Живое преломление в духе Glass-HQ liquid-glass.
/// Захватывает монитор под островом (Windows.Graphics.Capture) и рисует
/// кольцо преломления и блик в swapchain, встроенный в дерево Composition
/// поверх HostBackdrop-блюра. Само окно подложки исключено из захвата,
/// поэтому стекло не преломляет своё же отражение.
/// </summary>
internal sealed class LiveRefraction : IDisposable
{
    private const int MaxShapes = 4;

    private const string ShaderSource = @"
cbuffer P : register(b0)
{
    float4 Origin;
    float4 Shape[4];
    float4 Radii;
    float4 Optics;
    float4 Light;
};

Texture2D Cap : register(t0);
SamplerState Samp : register(s0);

struct VSOut { float4 pos : SV_Position; };

VSOut VS(uint id : SV_VertexID)
{
    float2 uv = float2((id << 1) & 2, id & 2);
    VSOut o;
    o.pos = float4(uv * float2(2.0, -2.0) + float2(-1.0, 1.0), 0.0, 1.0);
    return o;
}

// Знаковое расстояние до скруглённого прямоугольника: внутри отрицательное
float SdRound(float2 p, float4 r, float rad)
{
    float2 c = r.xy + r.zw * 0.5;
    float rr = min(rad, min(r.z, r.w) * 0.5);
    float2 q = abs(p - c) - (r.zw * 0.5 - rr);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rr;
}

float4 PS(VSOut i) : SV_Target
{
    float2 p = i.pos.xy;
    int count = (int)Optics.x;
    float d = 1e9;
    int k = 0;
    [loop] for (int s = 0; s < count; s++)
    {
        float ds = SdRound(p, Shape[s], Radii[s]);
        if (ds < d) { d = ds; k = s; }
    }

    float cov = saturate(0.5 - d);
    if (cov <= 0.0) { return float4(0, 0, 0, 0); }

    float4 sh = Shape[k];
    float rad = Radii[k];
    float2 e = float2(0.5, 0.0);
    float2 grad = float2(
        SdRound(p + e.xy, sh, rad) - SdRound(p - e.xy, sh, rad),
        SdRound(p + e.yx, sh, rad) - SdRound(p - e.yx, sh, rad));
    float2 n = grad / max(length(grad), 1e-5);

    // optics.ts edgeDisplacement: максимум у кромки, ноль на глубине фаски
    float bezel = max(Optics.z, 1.0);
    float depth = saturate(-d / bezel);
    float edge = 1.0 - sqrt(saturate((2.0 - depth) * depth));

    bool clearGlass = Light.z > 0.5;
    float2 disp = n * edge * Optics.y;
    float2 lo = float2(0.5, 0.5);
    float2 hi = Origin.zw - 0.5;
    float2 src = clamp(Origin.xy + p - disp, lo, hi);
    float3 c = Cap.SampleLevel(Samp, src / Origin.zw, 0).rgb;
    if (clearGlass && Light.w > 0.0)
    {
        // Дисперсия у кромки: красный и синий преломляются чуть по-разному
        float2 srcR = clamp(Origin.xy + p - disp * (1.0 - Light.w), lo, hi);
        float2 srcB = clamp(Origin.xy + p - disp * (1.0 + Light.w), lo, hi);
        c.r = Cap.SampleLevel(Samp, srcR / Origin.zw, 0).r;
        c.b = Cap.SampleLevel(Samp, srcB / Origin.zw, 0).b;
    }
    if (clearGlass)
    {
        // materials.ts clear/dark: подъём теней, срез светов и лёгкий бледный тон
        float3 tone = c + 0.15 * pow(1.0 - c, 3.0) - 0.20 * pow(c, 3.0);
        float3 tinted = 0.38 * c + 0.20;
        c = saturate(0.86 * tone + 0.14 * tinted);
        c = lerp(c, float3(12.0, 12.0, 14.0) / 255.0, Optics.w);
    }
    else
    {
        c = lerp(c, float3(12.0, 12.0, 14.0) / 255.0, Optics.w * 0.6);
    }

    // maps.wgsl: направленный блик сверху и снизу по тонкой кромке
    float cs = cos(1.08);
    float directional = pow(saturate((abs(n.y) - cs) / (1.0 - cs)), 1.25);
    // У прозрачного стекла кромка блика шире и мягче
    float strokeWidth = clearGlass ? 1.4 : 0.9;
    float stroke = saturate(1.0 - abs(d + strokeWidth) / strokeWidth);
    float spec = directional * stroke;
    spec = spec / (1.0 + 0.5 * (1.0 - spec));
    float diffuse = directional * 0.18 * pow(1.0 - saturate(-d / 4.5), 2.0);
    float hl = saturate((spec + diffuse) * Light.x);

    // Матовое: только кольцо у кромки поверх блюра. Прозрачное: вся фигура.
    float mask = clearGlass ? 1.0 : saturate(edge * Light.y);
    float3 rgb = c * mask;
    float a = mask;
    rgb = rgb * (1.0 - hl) + hl;
    a = a * (1.0 - hl) + hl;
    return float4(rgb * cov, a * cov);
}
";

    private readonly object _gate = new();
    private readonly Compositor _compositor;
    private readonly ID3D11Device _device;
    private readonly ID3D11DeviceContext _context;
    private readonly ID3D11VertexShader _vertexShader;
    private readonly ID3D11PixelShader _pixelShader;
    private readonly ID3D11SamplerState _sampler;
    private readonly ID3D11Buffer _constants;
    private readonly IDirect3DDevice _captureDevice;

    private IDXGISwapChain1? _swapChain;
    private ID3D11RenderTargetView? _renderTarget;
    private ID3D11Texture2D? _frame;
    private ID3D11ShaderResourceView? _frameView;
    private int _frameWidth;
    private int _frameHeight;
    private int _width;
    private int _height;

    private GraphicsCaptureItem? _item;
    private Direct3D11CaptureFramePool? _pool;
    private GraphicsCaptureSession? _session;
    private IntPtr _monitor;
    private CaptureInterop.RECT _monitorRect;

    private RefractionParams _params;
    private bool _active;
    private bool _disposed;

    /// <summary>Визуал со swapchain: кладётся поверх блюра в корень дерева.</summary>
    public SpriteVisual Visual { get; }

    public LiveRefraction(Compositor compositor)
    {
        _compositor = compositor;

        var levels = new[] { FeatureLevel.Level_11_1, FeatureLevel.Level_11_0, FeatureLevel.Level_10_1 };
        D3D11.D3D11CreateDevice(
            null,
            DriverType.Hardware,
            DeviceCreationFlags.BgraSupport,
            levels,
            out ID3D11Device device,
            out ID3D11DeviceContext context).CheckError();
        _device = device;
        _context = context;

        // Кадры захвата приходят из пула в другом потоке
        using (var multithread = _device.QueryInterface<ID3D11Multithread>())
        {
            multithread.SetMultithreadProtected(true);
        }

        var vs = Compiler.Compile(ShaderSource, "VS", "refraction.hlsl", "vs_5_0");
        var ps = Compiler.Compile(ShaderSource, "PS", "refraction.hlsl", "ps_5_0");
        _vertexShader = _device.CreateVertexShader(vs.Span);
        _pixelShader = _device.CreatePixelShader(ps.Span);

        _sampler = _device.CreateSamplerState(new SamplerDescription(
            Filter.MinMagMipLinear,
            TextureAddressMode.Clamp,
            TextureAddressMode.Clamp,
            TextureAddressMode.Clamp));

        _constants = _device.CreateBuffer(new BufferDescription(
            (uint)Marshal.SizeOf<RefractionParams>(),
            BindFlags.ConstantBuffer,
            ResourceUsage.Default));

        using (var dxgiDevice = _device.QueryInterface<IDXGIDevice>())
        {
            var hr = CaptureInterop.CreateDirect3D11DeviceFromDXGIDevice(dxgiDevice.NativePointer, out var winrtDevice);
            if (hr != 0 || winrtDevice == IntPtr.Zero)
            {
                throw new InvalidOperationException($"CreateDirect3D11DeviceFromDXGIDevice hr=0x{hr:X8}");
            }
            _captureDevice = MarshalInterface<IDirect3DDevice>.FromAbi(winrtDevice);
            Marshal.Release(winrtDevice);
        }

        Visual = _compositor.CreateSpriteVisual();
        Visual.IsVisible = false;

        RequestBorderlessCapture();
    }

    /// <summary>
    /// Без жёлтой рамки захвата. Для распакованного Win32-приложения
    /// Windows 11 разрешает это без манифеста возможностей.
    /// </summary>
    private static void RequestBorderlessCapture()
    {
        var thread = new Thread(() =>
        {
            try
            {
                var status = GraphicsCaptureAccess
                    .RequestAccessAsync(GraphicsCaptureAccessKind.Borderless)
                    .AsTask()
                    .GetAwaiter()
                    .GetResult();
                BackdropWindow.Log($"borderless capture access: {status}");
            }
            catch (Exception ex)
            {
                BackdropWindow.Log($"borderless capture access failed: {ex.Message}");
            }
        })
        {
            IsBackground = true,
            Name = "island-capture-access",
        };
        thread.Start();
    }

    /// <summary>
    /// Новая геометрия: окно подложки на экране и фигуры в его пикселях.
    /// Вызывается из UI-потока подложки.
    /// </summary>
    public void Update(int windowX, int windowY, int width, int height, IReadOnlyList<GlassShape> shapes, double tint, bool clear = false)
    {
        if (_disposed || width < 1 || height < 1 || shapes.Count == 0)
        {
            return;
        }
        try
        {
            EnsureCapture(windowX, windowY, width, height);
            lock (_gate)
            {
                EnsureSwapChain(width, height);
                _params = BuildParams(windowX, windowY, shapes, tint, clear);
                _active = true;
            }
            Visual.Size = new Vector2(width, height);
            Visual.IsVisible = true;
            Render();
        }
        catch (Exception ex)
        {
            BackdropWindow.Log($"refraction update failed: {ex.Message}");
        }
    }

    /// <summary>Подложка скрыта: захват останавливается, GPU не тратится.</summary>
    public void Pause()
    {
        try
        {
            lock (_gate)
            {
                _active = false;
            }
            Visual.IsVisible = false;
            StopCapture();
        }
        catch (Exception ex)
        {
            BackdropWindow.Log($"refraction pause failed: {ex.Message}");
        }
    }

    /// <summary>Сила преломления и ширина фаски по размеру самой маленькой фигуры.</summary>
    private RefractionParams BuildParams(int windowX, int windowY, IReadOnlyList<GlassShape> shapes, double tint, bool clear)
    {
        var p = new RefractionParams();
        var count = Math.Min(MaxShapes, shapes.Count);
        var minDim = float.MaxValue;
        var radii = new float[4];
        var rects = new Vector4[4];
        for (var i = 0; i < count; i++)
        {
            var s = shapes[i];
            rects[i] = new Vector4(s.X, s.Y, s.W, s.H);
            radii[i] = s.R;
            minDim = Math.Min(minDim, Math.Min(s.W, s.H));
        }
        p.Shape0 = rects[0];
        p.Shape1 = rects[1];
        p.Shape2 = rects[2];
        p.Shape3 = rects[3];
        p.Radii = new Vector4(radii[0], radii[1], radii[2], radii[3]);

        // Как в Glass-HQ: преломление маленькой фигуры ограничено её отступом.
        // Прозрачное стекло — сильнее изгиб, ярче блик и радужная кромка.
        var bezel = clear
            ? Math.Clamp(minDim * 0.42f, 5f, 26f)
            : Math.Clamp(minDim * 0.3f, 4f, 20f);
        var refraction = clear
            ? Math.Clamp(minDim * 0.55f, 6f, 40f)
            : Math.Clamp(minDim * 0.35f, 4f, 30f);
        // Прозрачная панель: преломление мягче, чтобы рейка у края не двоилась в стекле
        if (clear && minDim > 160f)
        {
            bezel = 16f;
            refraction = 20f;
        }
        var specular = clear ? 1.5f : 0.9f;
        var chroma = clear ? 0.06f : 0f;
        p.Optics = new Vector4(count, refraction, bezel, (float)Math.Clamp(tint, 0, 1));
        p.Light = new Vector4(specular, 1.0f, clear ? 1f : 0f, chroma);
        p.Origin = new Vector4(
            windowX - _monitorRect.Left,
            windowY - _monitorRect.Top,
            Math.Max(1, _frameWidth),
            Math.Max(1, _frameHeight));
        return p;
    }

    /// <summary>Захват того монитора, на котором сейчас окно.</summary>
    private void EnsureCapture(int x, int y, int w, int h)
    {
        var rect = new CaptureInterop.RECT { Left = x, Top = y, Right = x + w, Bottom = y + h };
        var monitor = CaptureInterop.MonitorFromRect(ref rect, CaptureInterop.MONITOR_DEFAULTTONEAREST);
        if (monitor == _monitor && _session != null)
        {
            return;
        }
        StopCapture();

        var info = new CaptureInterop.MONITORINFO { cbSize = Marshal.SizeOf<CaptureInterop.MONITORINFO>() };
        if (!CaptureInterop.GetMonitorInfoW(monitor, ref info))
        {
            throw new InvalidOperationException("GetMonitorInfo failed");
        }
        _monitor = monitor;
        _monitorRect = info.rcMonitor;

        var factory = ActivationFactory.Get("Windows.Graphics.Capture.GraphicsCaptureItem");
        var interop = CaptureInterop.QueryComInterface<IGraphicsCaptureItemInterop>(factory.ThisPtr);
        var iid = CaptureInterop.GraphicsCaptureItemIid;
        var itemPtr = interop.CreateForMonitor(monitor, ref iid);
        _item = GraphicsCaptureItem.FromAbi(itemPtr);
        Marshal.Release(itemPtr);

        _pool = Direct3D11CaptureFramePool.CreateFreeThreaded(
            _captureDevice,
            DirectXPixelFormat.B8G8R8A8UIntNormalized,
            2,
            _item.Size);
        _pool.FrameArrived += OnFrameArrived;
        _session = _pool.CreateCaptureSession(_item);
        try
        {
            _session.IsCursorCaptureEnabled = false;
        }
        catch (Exception ex)
        {
            BackdropWindow.Log($"cursor capture flag failed: {ex.Message}");
        }
        try
        {
            _session.IsBorderRequired = false;
        }
        catch (Exception ex)
        {
            BackdropWindow.Log($"border flag failed: {ex.Message}");
        }
        _session.StartCapture();
        BackdropWindow.Log($"capture started {_item.Size.Width}x{_item.Size.Height}");
    }

    private void StopCapture()
    {
        try
        {
            if (_pool != null)
            {
                _pool.FrameArrived -= OnFrameArrived;
            }
            _session?.Dispose();
            _pool?.Dispose();
        }
        catch (Exception ex)
        {
            BackdropWindow.Log($"stop capture failed: {ex.Message}");
        }
        _session = null;
        _pool = null;
        _item = null;
        _monitor = IntPtr.Zero;
    }

    /// <summary>Новый кадр экрана: копия в свою текстуру и перерисовка.</summary>
    private void OnFrameArrived(Direct3D11CaptureFramePool sender, object args)
    {
        try
        {
            using var frame = sender.TryGetNextFrame();
            if (frame == null)
            {
                return;
            }
            var size = frame.ContentSize;
            if (_item != null && (size.Width != _item.Size.Width || size.Height != _item.Size.Height))
            {
                sender.Recreate(_captureDevice, DirectXPixelFormat.B8G8R8A8UIntNormalized, 2, size);
            }

            var access = CaptureInterop.QueryComInterface<IDirect3DDxgiInterfaceAccess>(
                ((IWinRTObject)frame.Surface).NativeObject.ThisPtr);
            var iid = CaptureInterop.Texture2DIid;
            var texPtr = access.GetInterface(ref iid);
            using var texture = new ID3D11Texture2D(texPtr);

            lock (_gate)
            {
                var desc = texture.Description;
                EnsureFrameTexture((int)desc.Width, (int)desc.Height, desc.Format);
                _context.CopyResource(_frame!, texture);
                _params.Origin.Z = _frameWidth;
                _params.Origin.W = _frameHeight;
            }
            Render();
        }
        catch (Exception ex)
        {
            BackdropWindow.Log($"frame failed: {ex.Message}");
        }
    }

    private void EnsureFrameTexture(int width, int height, Format format)
    {
        if (_frame != null && width == _frameWidth && height == _frameHeight)
        {
            return;
        }
        _frameView?.Dispose();
        _frame?.Dispose();
        _frame = _device.CreateTexture2D(new Texture2DDescription(
            format,
            (uint)width,
            (uint)height,
            1,
            1,
            BindFlags.ShaderResource));
        _frameView = _device.CreateShaderResourceView(_frame);
        _frameWidth = width;
        _frameHeight = height;
    }

    /// <summary>Swapchain размером с окно; при первом создании — кисть для визуала.</summary>
    private void EnsureSwapChain(int width, int height)
    {
        if (_swapChain != null && width == _width && height == _height)
        {
            return;
        }
        _renderTarget?.Dispose();
        _renderTarget = null;

        if (_swapChain == null)
        {
            var desc = new SwapChainDescription1
            {
                Width = (uint)width,
                Height = (uint)height,
                Format = Format.B8G8R8A8_UNorm,
                BufferCount = 2,
                BufferUsage = Usage.RenderTargetOutput,
                SampleDescription = new SampleDescription(1, 0),
                Scaling = Scaling.Stretch,
                SwapEffect = SwapEffect.FlipSequential,
                AlphaMode = AlphaMode.Premultiplied,
            };
            using var dxgiDevice = _device.QueryInterface<IDXGIDevice>();
            using var adapter = dxgiDevice.GetAdapter();
            using var factory = adapter.GetParent<IDXGIFactory2>();
            _swapChain = factory.CreateSwapChainForComposition(_device, desc);

            var interop = CaptureInterop.QueryComInterface<ICompositorInterop>(
                ((IWinRTObject)_compositor).NativeObject.ThisPtr);
            var surfacePtr = interop.CreateCompositionSurfaceForSwapChain(_swapChain.NativePointer);
            var surface = MarshalInterface<ICompositionSurface>.FromAbi(surfacePtr);
            Marshal.Release(surfacePtr);
            var brush = _compositor.CreateSurfaceBrush(surface);
            brush.Stretch = CompositionStretch.Fill;
            Visual.Brush = brush;
        }
        else
        {
            _swapChain.ResizeBuffers(2, (uint)width, (uint)height, Format.B8G8R8A8_UNorm, SwapChainFlags.None).CheckError();
        }

        using (var backBuffer = _swapChain.GetBuffer<ID3D11Texture2D>(0))
        {
            _renderTarget = _device.CreateRenderTargetView(backBuffer);
        }
        _width = width;
        _height = height;
    }

    /// <summary>Один проход: полноэкранный треугольник с шейдером преломления.</summary>
    private void Render()
    {
        lock (_gate)
        {
            if (!_active || _disposed || _swapChain == null || _renderTarget == null)
            {
                return;
            }
            try
            {
                _context.UpdateSubresource(in _params, _constants);
                _context.OMSetRenderTargets(_renderTarget);
                _context.ClearRenderTargetView(_renderTarget, new Color4(0, 0, 0, 0));
                if (_frameView == null)
                {
                    // Первого кадра ещё нет: пустой прозрачный слой, под ним блюр
                    _swapChain.Present(0, PresentFlags.None);
                    return;
                }
                _context.RSSetViewport(new Viewport(0, 0, _width, _height));
                _context.IASetPrimitiveTopology(PrimitiveTopology.TriangleList);
                _context.VSSetShader(_vertexShader);
                _context.PSSetShader(_pixelShader);
                _context.PSSetConstantBuffer(0, _constants);
                _context.PSSetShaderResource(0, _frameView);
                _context.PSSetSampler(0, _sampler);
                _context.Draw(3, 0);
                _swapChain.Present(0, PresentFlags.None);
            }
            catch (Exception ex)
            {
                BackdropWindow.Log($"render failed: {ex.Message}");
            }
        }
    }

    /// <summary>
    /// Отладка: сохраняет слой преломления (overlay.bmp) и его же поверх
    /// захваченного фона (composite.bmp). Нужен потому, что окно подложки
    /// исключено из захвата и обычный скриншот стекла не видит.
    /// </summary>
    public void DumpTo(string directory)
    {
        lock (_gate)
        {
            try
            {
                if (_swapChain == null || _frame == null)
                {
                    BackdropWindow.Log("dump: nothing rendered yet");
                    return;
                }
                Directory.CreateDirectory(directory);
                var overlay = ReadTexture(_swapChain.GetBuffer<ID3D11Texture2D>(0), 0, 0, _width, _height);
                var ox = (int)_params.Origin.X;
                var oy = (int)_params.Origin.Y;
                var background = ReadTexture(_frame, ox, oy, _width, _height, dispose: false);
                var composite = new byte[overlay.Length];
                for (var i = 0; i < overlay.Length; i += 4)
                {
                    var a = overlay[i + 3] / 255f;
                    for (var c = 0; c < 3; c++)
                    {
                        composite[i + c] = (byte)Math.Clamp(overlay[i + c] + background[i + c] * (1 - a), 0, 255);
                    }
                    composite[i + 3] = 255;
                }
                WriteBmp(Path.Combine(directory, "overlay.bmp"), overlay, _width, _height);
                WriteBmp(Path.Combine(directory, "composite.bmp"), composite, _width, _height);
                WriteBmp(Path.Combine(directory, "background.bmp"), background, _width, _height);
                BackdropWindow.Log($"dump written to {directory}");
            }
            catch (Exception ex)
            {
                BackdropWindow.Log($"dump failed: {ex}");
            }
        }
    }

    /// <summary>Копия области текстуры в BGRA-байты через staging-текстуру.</summary>
    private byte[] ReadTexture(ID3D11Texture2D source, int x, int y, int width, int height, bool dispose = true)
    {
        try
        {
            var srcDesc = source.Description;
            using var staging = _device.CreateTexture2D(new Texture2DDescription(
                srcDesc.Format,
                (uint)width,
                (uint)height,
                1,
                1,
                BindFlags.None,
                ResourceUsage.Staging,
                CpuAccessFlags.Read));
            var left = Math.Clamp(x, 0, (int)srcDesc.Width - 1);
            var top = Math.Clamp(y, 0, (int)srcDesc.Height - 1);
            var right = Math.Min(left + width, (int)srcDesc.Width);
            var bottom = Math.Min(top + height, (int)srcDesc.Height);
            _context.CopySubresourceRegion(staging, 0, 0, 0, 0, source, 0, new Box(left, top, 0, right, bottom, 1));
            var mapped = _context.Map(staging, 0, MapMode.Read, Vortice.Direct3D11.MapFlags.None);
            var bytes = new byte[width * height * 4];
            try
            {
                for (var row = 0; row < height; row++)
                {
                    Marshal.Copy(mapped.DataPointer + (nint)(row * mapped.RowPitch), bytes, row * width * 4, width * 4);
                }
            }
            finally
            {
                _context.Unmap(staging, 0);
            }
            return bytes;
        }
        finally
        {
            if (dispose)
            {
                source.Dispose();
            }
        }
    }

    /// <summary>32-битный BMP сверху вниз (отрицательная высота).</summary>
    private static void WriteBmp(string path, byte[] bgra, int width, int height)
    {
        using var stream = File.Create(path);
        using var writer = new BinaryWriter(stream);
        var dataSize = bgra.Length;
        writer.Write((byte)'B');
        writer.Write((byte)'M');
        writer.Write(14 + 40 + dataSize);
        writer.Write(0);
        writer.Write(14 + 40);
        writer.Write(40);
        writer.Write(width);
        writer.Write(-height);
        writer.Write((short)1);
        writer.Write((short)32);
        writer.Write(0);
        writer.Write(dataSize);
        writer.Write(2835);
        writer.Write(2835);
        writer.Write(0);
        writer.Write(0);
        writer.Write(bgra);
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }
        _disposed = true;
        StopCapture();
        lock (_gate)
        {
            _renderTarget?.Dispose();
            _swapChain?.Dispose();
            _frameView?.Dispose();
            _frame?.Dispose();
            _constants.Dispose();
            _sampler.Dispose();
            _pixelShader.Dispose();
            _vertexShader.Dispose();
            _context.Dispose();
            _device.Dispose();
        }
    }
}
