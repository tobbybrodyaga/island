using System.Collections.Concurrent;
using System.Numerics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Windows.UI;
using Windows.UI.Composition;
using Windows.UI.Composition.Desktop;
using WinRT;

namespace IslandBackdrop;

/// <summary>
/// Команда от Electron: одна строка JSON в stdin.
/// Координаты и радиус в физических пикселях экрана.
/// </summary>
internal sealed class BackdropCommand
{
    [JsonPropertyName("cmd")] public string? Cmd { get; set; }
    [JsonPropertyName("x")] public int X { get; set; }
    [JsonPropertyName("y")] public int Y { get; set; }
    [JsonPropertyName("w")] public int W { get; set; }
    [JsonPropertyName("h")] public int H { get; set; }
    [JsonPropertyName("r")] public double R { get; set; }
    /// <summary>free | top | bottom | left | right — какая сторона плоская</summary>
    [JsonPropertyName("edge")] public string? Edge { get; set; }
    /// <summary>HWND окна Electron: подложка встаёт строго под него в Z-порядке</summary>
    [JsonPropertyName("owner")] public long Owner { get; set; }
    /// <summary>Альфа тёмного тинта 0..1 (0 = тинт рисует Electron в CSS)</summary>
    [JsonPropertyName("tint")] public double Tint { get; set; }
    /// <summary>Несколько фигур для разворота. Координаты в физических пикселях экрана.</summary>
    [JsonPropertyName("items")] public List<ShapeItem>? Items { get; set; }
    /// <summary>regular — матовое (блюр + кольцо преломления), clear — прозрачное без блюра</summary>
    [JsonPropertyName("material")] public string? Material { get; set; }

    /// <summary>Прозрачное стекло в духе Glass-HQ clear.</summary>
    [JsonIgnore]
    public bool IsClear => string.Equals(Material, "clear", StringComparison.OrdinalIgnoreCase);
}

/// <summary>Один скруглённый кусок подложки.</summary>
internal sealed class ShapeItem
{
    [JsonPropertyName("x")] public int X { get; set; }
    [JsonPropertyName("y")] public int Y { get; set; }
    [JsonPropertyName("w")] public int W { get; set; }
    [JsonPropertyName("h")] public int H { get; set; }
    [JsonPropertyName("r")] public double R { get; set; }
}

/// <summary>
/// Win32 + DWM + CoreMessaging интероп.
/// </summary>
internal static class Native
{
    public const int WS_POPUP = unchecked((int)0x80000000);
    public const int WS_EX_TOOLWINDOW = 0x00000080;
    public const int WS_EX_TOPMOST = 0x00000008;
    public const int WS_EX_TRANSPARENT = 0x00000020;
    public const int WS_EX_NOACTIVATE = 0x08000000;
    public const int WS_EX_NOREDIRECTIONBITMAP = 0x00200000;

    public const uint WM_DESTROY = 0x0002;
    public const uint WM_NCHITTEST = 0x0084;
    public const uint WM_APP = 0x8000;
    public const uint WM_APP_COMMAND = WM_APP + 1;

    public const int HTTRANSPARENT = -1;

    public const uint SWP_NOACTIVATE = 0x0010;
    public const uint SWP_SHOWWINDOW = 0x0040;
    public const uint SWP_NOZORDER = 0x0004;
    public const uint SWP_NOOWNERZORDER = 0x0200;

    public const int SW_HIDE = 0;
    public const int SW_SHOWNOACTIVATE = 4;

    public static readonly IntPtr HWND_TOPMOST = new(-1);

    public const int DWMWA_USE_HOSTBACKDROPBRUSH = 17;
    public const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;
    public const int DWMWCP_DONOTROUND = 1;

    public delegate IntPtr WndProcDelegate(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct WNDCLASSEXW
    {
        public uint cbSize;
        public uint style;
        public IntPtr lpfnWndProc;
        public int cbClsExtra;
        public int cbWndExtra;
        public IntPtr hInstance;
        public IntPtr hIcon;
        public IntPtr hCursor;
        public IntPtr hbrBackground;
        public IntPtr lpszMenuName;
        public IntPtr lpszClassName;
        public IntPtr hIconSm;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public POINT pt;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct DispatcherQueueOptions
    {
        public int dwSize;
        public int threadType;
        public int apartmentType;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct ACCENT_POLICY
    {
        public int AccentState;
        public int AccentFlags;
        public uint GradientColor;
        public int AnimationId;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct WINDOWCOMPOSITIONATTRIBDATA
    {
        public int Attribute;
        public IntPtr Data;
        public int SizeOfData;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern ushort RegisterClassExW(ref WNDCLASSEXW lpwcx);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr CreateWindowExW(
        int dwExStyle,
        string lpClassName,
        string lpWindowName,
        int dwStyle,
        int x,
        int y,
        int nWidth,
        int nHeight,
        IntPtr hWndParent,
        IntPtr hMenu,
        IntPtr hInstance,
        IntPtr lpParam);

    [DllImport("user32.dll")]
    public static extern IntPtr DefWindowProcW(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern void PostQuitMessage(int nExitCode);

    [DllImport("user32.dll")]
    public static extern int GetMessageW(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

    [DllImport("user32.dll")]
    public static extern bool TranslateMessage(ref MSG lpMsg);

    [DllImport("user32.dll")]
    public static extern IntPtr DispatchMessageW(ref MSG lpMsg);

    [DllImport("user32.dll")]
    public static extern bool PostMessageW(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetWindowPos(
        IntPtr hWnd,
        IntPtr hWndInsertAfter,
        int x,
        int y,
        int cx,
        int cy,
        uint uFlags);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool DestroyWindow(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern int SetWindowCompositionAttribute(IntPtr hwnd, ref WINDOWCOMPOSITIONATTRIBDATA data);

    [DllImport("kernel32.dll")]
    public static extern IntPtr GetModuleHandleW(IntPtr lpModuleName);

    [DllImport("dwmapi.dll")]
    public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    [DllImport("CoreMessaging.dll", ExactSpelling = true)]
    public static extern int CreateDispatcherQueueController(
        DispatcherQueueOptions options,
        out IntPtr dispatcherQueueController);
}

/// <summary>
/// ICompositorDesktopInterop: привязка Compositor к HWND.
/// </summary>
[ComImport]
[Guid("29E691FA-4567-4DCA-B319-D0F207EB6807")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface ICompositorDesktopInterop
{
    void CreateDesktopWindowTarget(
        IntPtr hwndTarget,
        [MarshalAs(UnmanagedType.Bool)] bool isTopmost,
        out IntPtr result);

    void EnsureOnThread(int threadId);
}

/// <summary>
/// Окно-подложка: HostBackdropBrush (живой DWM-блюр) внутри геометрического клипа капсулы.
/// </summary>
internal sealed class BackdropWindow
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
    };

    private readonly ConcurrentQueue<BackdropCommand> _queue = new();
    private readonly Native.WndProcDelegate _wndProc;
    private IntPtr _hwnd;
    private IntPtr _dispatcherController;

    private Compositor? _compositor;
    private DesktopWindowTarget? _target;
    private ContainerVisual? _root;
    private ContainerVisual? _content;
    private SpriteVisual? _backdrop;
    private SpriteVisual? _tint;
    private CompositionRoundedRectangleGeometry? _geometry;
    private CompositionColorBrush? _tintBrush;
    private CompositionBrush? _hostBrush;
    private readonly List<ShapeSlot> _slots = new();
    /// <summary>Живое преломление поверх блюра; null — работает только блюр.</summary>
    private LiveRefraction? _refraction;

    private bool _visible;

    public BackdropWindow()
    {
        _wndProc = WndProc;
    }

    /// <summary>Создаёт окно, dispatcher queue и дерево визуалов.</summary>
    public void Initialize()
    {
        EnsureDispatcherQueue();
        CreateNativeWindow();
        EnableHostBackdrop(_hwnd);
        BuildComposition();
        ExcludeFromCapture();
        CreateRefraction();
    }

    /// <summary>
    /// Слой стекла не попадает в захват экрана: иначе преломление видит само себя.
    /// Окно Electron с текстом и значками остаётся видимым на скриншотах.
    /// </summary>
    private void ExcludeFromCapture()
    {
        try
        {
            if (!CaptureInterop.SetWindowDisplayAffinity(_hwnd, CaptureInterop.WDA_EXCLUDEFROMCAPTURE))
            {
                Log($"SetWindowDisplayAffinity failed: {Marshal.GetLastWin32Error()}");
            }
        }
        catch (Exception ex)
        {
            Log($"exclude from capture failed: {ex.Message}");
        }
    }

    /// <summary>Преломление поверх блюра. Не получилось — остаётся один блюр.</summary>
    private void CreateRefraction()
    {
        try
        {
            if (_compositor == null || _root == null)
            {
                return;
            }
            _refraction = new LiveRefraction(_compositor);
            _root.Children.InsertAtTop(_refraction.Visual);
        }
        catch (Exception ex)
        {
            Log($"refraction disabled: {ex}");
            _refraction = null;
        }
    }

    /// <summary>Читает stdin в фоне и постит команды в UI-поток.</summary>
    public void StartStdinPump()
    {
        var thread = new Thread(() =>
        {
            try
            {
                using var reader = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
                string? line;
                while ((line = reader.ReadLine()) != null)
                {
                    line = line.Trim();
                    if (line.Length == 0)
                    {
                        continue;
                    }
                    try
                    {
                        var cmd = JsonSerializer.Deserialize<BackdropCommand>(line, JsonOpts);
                        if (cmd != null)
                        {
                            _queue.Enqueue(cmd);
                            Native.PostMessageW(_hwnd, Native.WM_APP_COMMAND, IntPtr.Zero, IntPtr.Zero);
                        }
                    }
                    catch (Exception ex)
                    {
                        Log($"bad command: {ex.Message}");
                    }
                }
            }
            catch (Exception ex)
            {
                Log($"stdin pump failed: {ex.Message}");
            }

            // Родитель закрыл поток → выходим вместе с ним
            _queue.Enqueue(new BackdropCommand { Cmd = "quit" });
            Native.PostMessageW(_hwnd, Native.WM_APP_COMMAND, IntPtr.Zero, IntPtr.Zero);
        })
        {
            IsBackground = true,
            Name = "island-backdrop-stdin",
        };
        thread.Start();
    }

    /// <summary>Отладочный дамп слоя преломления (demo --dump).</summary>
    public void DumpRefraction(string directory)
    {
        _refraction?.DumpTo(directory);
    }

    /// <summary>Кладёт команду напрямую (для demo-режима).</summary>
    public void Enqueue(BackdropCommand cmd)
    {
        _queue.Enqueue(cmd);
        Native.PostMessageW(_hwnd, Native.WM_APP_COMMAND, IntPtr.Zero, IntPtr.Zero);
    }

    /// <summary>Стандартный цикл сообщений.</summary>
    public void RunMessageLoop()
    {
        while (Native.GetMessageW(out var msg, IntPtr.Zero, 0, 0) > 0)
        {
            Native.TranslateMessage(ref msg);
            Native.DispatchMessageW(ref msg);
        }
    }

    private void EnsureDispatcherQueue()
    {
        // 2 = DQTYPE_THREAD_CURRENT; apartment: 2 = STA, 1 = ASTA, 0 = NONE
        foreach (var apartment in new[] { 2, 1, 0 })
        {
            var options = new Native.DispatcherQueueOptions
            {
                dwSize = Marshal.SizeOf<Native.DispatcherQueueOptions>(),
                threadType = 2,
                apartmentType = apartment,
            };
            var hr = Native.CreateDispatcherQueueController(options, out _dispatcherController);
            if (hr == 0 && _dispatcherController != IntPtr.Zero)
            {
                return;
            }
            Log($"CreateDispatcherQueueController(apartment={apartment}) hr=0x{hr:X8}");
        }
        throw new InvalidOperationException("DispatcherQueue unavailable");
    }

    private void CreateNativeWindow()
    {
        var hInstance = Native.GetModuleHandleW(IntPtr.Zero);
        const string className = "IslandBackdropWindow";

        var wc = new Native.WNDCLASSEXW
        {
            cbSize = (uint)Marshal.SizeOf<Native.WNDCLASSEXW>(),
            lpfnWndProc = Marshal.GetFunctionPointerForDelegate(_wndProc),
            hInstance = hInstance,
            lpszClassName = Marshal.StringToHGlobalUni(className),
        };
        var atom = Native.RegisterClassExW(ref wc);
        if (atom == 0)
        {
            var err = Marshal.GetLastWin32Error();
            // 1410 = ERROR_CLASS_ALREADY_EXISTS — допустимо
            if (err != 1410)
            {
                throw new InvalidOperationException($"RegisterClassExW failed: {err}");
            }
        }

        // WS_EX_NOREDIRECTIONBITMAP: окно рисует только Composition, без GDI-поверхности.
        // TRANSPARENT + NOACTIVATE: клики и фокус проходят к Electron сверху.
        var exStyle = Native.WS_EX_NOREDIRECTIONBITMAP
                      | Native.WS_EX_TOOLWINDOW
                      | Native.WS_EX_TOPMOST
                      | Native.WS_EX_TRANSPARENT
                      | Native.WS_EX_NOACTIVATE;

        _hwnd = Native.CreateWindowExW(
            exStyle,
            className,
            "Island Backdrop",
            Native.WS_POPUP,
            0,
            0,
            1,
            1,
            IntPtr.Zero,
            IntPtr.Zero,
            hInstance,
            IntPtr.Zero);

        if (_hwnd == IntPtr.Zero)
        {
            throw new InvalidOperationException($"CreateWindowExW failed: {Marshal.GetLastWin32Error()}");
        }

        // Никаких системных скруглений: форму задаёт наш клип
        var corner = Native.DWMWCP_DONOTROUND;
        _ = Native.DwmSetWindowAttribute(_hwnd, Native.DWMWA_WINDOW_CORNER_PREFERENCE, ref corner, sizeof(int));
    }

    /// <summary>
    /// Разрешает HostBackdropBrush для Win32-окна (Win11 22000+).
    /// Запасной путь — accent policy HOSTBACKDROP.
    /// </summary>
    private static void EnableHostBackdrop(IntPtr hwnd)
    {
        var enable = 1;
        var hr = Native.DwmSetWindowAttribute(hwnd, Native.DWMWA_USE_HOSTBACKDROPBRUSH, ref enable, sizeof(int));
        if (hr != 0)
        {
            Log($"DWMWA_USE_HOSTBACKDROPBRUSH hr=0x{hr:X8}, trying accent fallback");
        }

        try
        {
            // ACCENT_ENABLE_HOSTBACKDROP = 5, WCA_ACCENT_POLICY = 19
            var policy = new Native.ACCENT_POLICY
            {
                AccentState = 5,
                AccentFlags = 0,
                GradientColor = 0,
                AnimationId = 0,
            };
            var size = Marshal.SizeOf<Native.ACCENT_POLICY>();
            var buffer = Marshal.AllocHGlobal(size);
            try
            {
                Marshal.StructureToPtr(policy, buffer, false);
                var data = new Native.WINDOWCOMPOSITIONATTRIBDATA
                {
                    Attribute = 19,
                    Data = buffer,
                    SizeOfData = size,
                };
                _ = Native.SetWindowCompositionAttribute(hwnd, ref data);
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }
        catch (Exception ex)
        {
            Log($"accent fallback failed: {ex.Message}");
        }
    }

    private void BuildComposition()
    {
        _compositor = new Compositor();

        // Compositor → ICompositorDesktopInterop → DesktopWindowTarget
        var unk = ((IWinRTObject)_compositor).NativeObject.ThisPtr;
        var iid = typeof(ICompositorDesktopInterop).GUID;
        var qi = Marshal.QueryInterface(unk, ref iid, out var interopPtr);
        if (qi != 0 || interopPtr == IntPtr.Zero)
        {
            throw new InvalidOperationException($"ICompositorDesktopInterop QI failed hr=0x{qi:X8}");
        }
        var interop = (ICompositorDesktopInterop)Marshal.GetObjectForIUnknown(interopPtr);
        Marshal.Release(interopPtr);

        interop.CreateDesktopWindowTarget(_hwnd, false, out var targetPtr);
        _target = DesktopWindowTarget.FromAbi(targetPtr);

        _root = _compositor.CreateContainerVisual();

        // Клип на контейнере: и блюр, и тинт режутся одной геометрией
        _content = _compositor.CreateContainerVisual();
        _content.RelativeSizeAdjustment = Vector2.One;
        _geometry = _compositor.CreateRoundedRectangleGeometry();
        _content.Clip = _compositor.CreateGeometricClip(_geometry);

        _hostBrush = _compositor.CreateHostBackdropBrush();
        _backdrop = _compositor.CreateSpriteVisual();
        _backdrop.RelativeSizeAdjustment = Vector2.One;
        _backdrop.Brush = _hostBrush;
        _content.Children.InsertAtTop(_backdrop);

        _tintBrush = _compositor.CreateColorBrush(Color.FromArgb(0, 12, 12, 14));
        _tint = _compositor.CreateSpriteVisual();
        _tint.RelativeSizeAdjustment = Vector2.One;
        _tint.Brush = _tintBrush;
        _content.Children.InsertAtTop(_tint);

        _root.Children.InsertAtTop(_content);
        _target.Root = _root;
    }

    private IntPtr WndProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam)
    {
        try
        {
            switch (msg)
            {
                case Native.WM_NCHITTEST:
                    return new IntPtr(Native.HTTRANSPARENT);
                case Native.WM_APP_COMMAND:
                    DrainQueue();
                    return IntPtr.Zero;
                case Native.WM_DESTROY:
                    Native.PostQuitMessage(0);
                    return IntPtr.Zero;
            }
        }
        catch (Exception ex)
        {
            Log($"WndProc failed: {ex.Message}");
        }
        return Native.DefWindowProcW(hWnd, msg, wParam, lParam);
    }

    private void DrainQueue()
    {
        while (_queue.TryDequeue(out var cmd))
        {
            Apply(cmd);
        }
    }

    /// <summary>Применяет команду: геометрия, позиция, видимость.</summary>
    private void Apply(BackdropCommand cmd)
    {
        switch ((cmd.Cmd ?? "show").ToLowerInvariant())
        {
            case "quit":
                _refraction?.Dispose();
                _refraction = null;
                Native.DestroyWindow(_hwnd);
                return;
            case "hide":
                _refraction?.Pause();
                if (_visible)
                {
                    Native.ShowWindow(_hwnd, Native.SW_HIDE);
                    _visible = false;
                }
                return;
            case "shapes":
                ApplyShapes(cmd);
                return;
            case "show":
            default:
                ApplyShow(cmd);
                return;
        }
    }

    /// <summary>Одна фигура show: прячем набор shapes и рисуем прежний клип.</summary>
    private void HideShapeSlots()
    {
        foreach (var slot in _slots)
        {
            slot.Host.IsVisible = false;
        }
        if (_content != null)
        {
            _content.IsVisible = true;
        }
    }

    /// <summary>Несколько клипов. Окно — объединяющий прямоугольник, лишние visuals убираются.</summary>
    private void ApplyShapes(BackdropCommand cmd)
    {
        var items = (cmd.Items ?? new List<ShapeItem>())
            .Where(item => item.W > 1 && item.H > 1)
            .ToList();
        if (items.Count == 0 || _compositor == null || _root == null || _hostBrush == null)
        {
            HideShapeSlots();
            if (_visible)
            {
                Native.ShowWindow(_hwnd, Native.SW_HIDE);
                _visible = false;
            }
            return;
        }

        if (_content != null)
        {
            _content.IsVisible = false;
        }

        while (_slots.Count > items.Count)
        {
            var extra = _slots[^1];
            _root.Children.Remove(extra.Host);
            _slots.RemoveAt(_slots.Count - 1);
        }

        while (_slots.Count < items.Count)
        {
            var host = _compositor.CreateContainerVisual();
            var geometry = _compositor.CreateRoundedRectangleGeometry();
            host.Clip = _compositor.CreateGeometricClip(geometry);
            var blur = _compositor.CreateSpriteVisual();
            blur.RelativeSizeAdjustment = Vector2.One;
            blur.Brush = _hostBrush;
            var tintBrush = _compositor.CreateColorBrush(Color.FromArgb(0, 12, 12, 14));
            var tint = _compositor.CreateSpriteVisual();
            tint.RelativeSizeAdjustment = Vector2.One;
            tint.Brush = tintBrush;
            host.Children.InsertAtTop(blur);
            host.Children.InsertAtTop(tint);
            // Блюр всегда под слоем преломления
            if (_refraction != null)
            {
                _root.Children.InsertBelow(host, _refraction.Visual);
            }
            else
            {
                _root.Children.InsertAtTop(host);
            }
            _slots.Add(new ShapeSlot(host, geometry, tintBrush, blur));
        }

        var minX = items.Min(item => item.X);
        var minY = items.Min(item => item.Y);
        var maxX = items.Max(item => item.X + item.W);
        var maxY = items.Max(item => item.Y + item.H);
        var unionW = Math.Max(1, maxX - minX);
        var unionH = Math.Max(1, maxY - minY);
        _root.Size = new Vector2(unionW, unionH);

        var alpha = (byte)Math.Round(Math.Clamp(cmd.Tint, 0, 1) * 255);
        var edge = (cmd.Edge ?? "free").ToLowerInvariant();
        var glassShapes = new List<GlassShape>(items.Count);
        var clear = cmd.IsClear && _refraction != null;
        for (var i = 0; i < items.Count; i++)
        {
            var item = items[i];
            var slot = _slots[i];
            var w = Math.Max(1, item.W);
            var h = Math.Max(1, item.H);
            var r = (float)Math.Max(0, Math.Min(item.R, Math.Min(w, h) / 2.0));
            var localX = item.X - minX;
            var localY = item.Y - minY;
            slot.Host.IsVisible = true;
            slot.Host.Offset = new Vector3(localX, localY, 0);
            slot.Host.Size = new Vector2(w, h);
            var offset = Vector2.Zero;
            var size = new Vector2(w, h);
            // Плоская сторона только у фигур, которые касаются этого края окна.
            if (edge == "top" && localY <= 1)
            {
                offset = new Vector2(0, -r);
                size = new Vector2(w, h + r);
            }
            else if (edge == "bottom" && localY + h >= unionH - 1)
            {
                size = new Vector2(w, h + r);
            }
            else if (edge == "left" && localX <= 1)
            {
                offset = new Vector2(-r, 0);
                size = new Vector2(w + r, h);
            }
            else if (edge == "right" && localX + w >= unionW - 1)
            {
                size = new Vector2(w + r, h);
            }
            slot.Geometry.Offset = offset;
            slot.Geometry.Size = size;
            slot.Geometry.CornerRadius = new Vector2(r, r);
            // Прозрачное стекло: блюр и тинт рисует шейдер, своего слоя нет
            slot.Blur.IsVisible = !clear;
            slot.Tint.Color = Color.FromArgb(clear ? (byte)0 : alpha, 12, 12, 14);
            // Та же геометрия для шейдера: плоская сторона уходит за край окна
            glassShapes.Add(new GlassShape(localX + offset.X, localY + offset.Y, size.X, size.Y, r));
        }

        PlaceWindow(cmd.Owner, minX, minY, unionW, unionH);
        _refraction?.Update(minX, minY, unionW, unionH, glassShapes, cmd.Tint, clear);
    }

    private sealed class ShapeSlot
    {
        public ShapeSlot(ContainerVisual host, CompositionRoundedRectangleGeometry geometry, CompositionColorBrush tint, SpriteVisual blur)
        {
            Host = host;
            Geometry = geometry;
            Tint = tint;
            Blur = blur;
        }

        /// <summary>Живой блюр HostBackdrop; у прозрачного стекла выключен.</summary>
        public SpriteVisual Blur { get; }

        public ContainerVisual Host { get; }
        public CompositionRoundedRectangleGeometry Geometry { get; }
        public CompositionColorBrush Tint { get; }
    }

    private void ApplyShow(BackdropCommand cmd)
    {
        HideShapeSlots();
        var w = Math.Max(1, cmd.W);
        var h = Math.Max(1, cmd.H);
        var r = (float)Math.Max(0, Math.Min(cmd.R, Math.Min(w, h) / 2.0));
        GlassShape? glass = null;

        if (_root != null && _geometry != null)
        {
            _root.Size = new Vector2(w, h);

            // Плоская сторона: геометрия вылезает за окно на r,
            // и её скруглённые углы с той стороны отсекаются границей окна.
            var edge = (cmd.Edge ?? "free").ToLowerInvariant();
            var offset = Vector2.Zero;
            var size = new Vector2(w, h);
            switch (edge)
            {
                case "top":
                    offset = new Vector2(0, -r);
                    size = new Vector2(w, h + r);
                    break;
                case "bottom":
                    size = new Vector2(w, h + r);
                    break;
                case "left":
                    offset = new Vector2(-r, 0);
                    size = new Vector2(w + r, h);
                    break;
                case "right":
                    size = new Vector2(w + r, h);
                    break;
            }
            _geometry.Offset = offset;
            _geometry.Size = size;
            _geometry.CornerRadius = new Vector2(r, r);
            glass = new GlassShape(offset.X, offset.Y, size.X, size.Y, r);
        }

        var clear = cmd.IsClear && _refraction != null;
        if (_backdrop != null)
        {
            _backdrop.IsVisible = !clear;
        }
        if (_tintBrush != null)
        {
            var a = clear ? (byte)0 : (byte)Math.Round(Math.Clamp(cmd.Tint, 0, 1) * 255);
            _tintBrush.Color = Color.FromArgb(a, 12, 12, 14);
        }

        PlaceWindow(cmd.Owner, cmd.X, cmd.Y, w, h);
        if (glass is { } shape)
        {
            _refraction?.Update(cmd.X, cmd.Y, w, h, new[] { shape }, cmd.Tint, clear);
        }
    }

    /// <summary>Ставит окно подложки под HWND острова.</summary>
    private void PlaceWindow(long ownerValue, int x, int y, int w, int h)
    {
        var owner = new IntPtr(ownerValue);
        var insertAfter = owner != IntPtr.Zero && Native.IsWindow(owner)
            ? owner
            : Native.HWND_TOPMOST;
        var flags = Native.SWP_NOACTIVATE | Native.SWP_NOOWNERZORDER | Native.SWP_SHOWWINDOW;
        if (!Native.SetWindowPos(_hwnd, insertAfter, x, y, w, h, flags))
        {
            Log($"SetWindowPos failed: {Marshal.GetLastWin32Error()}");
        }
        _visible = true;
    }

    public static void Log(string message)
    {
        try
        {
            Console.Error.WriteLine($"[IslandBackdrop] {message}");
        }
        catch
        {
            /* stderr может отсутствовать */
        }
    }
}

internal static class Program
{
    /// <summary>
    /// Запуск: без аргументов — слушаем stdin от Electron.
    /// --demo [seconds] — показать капсулу для визуальной проверки и выйти.
    /// </summary>
    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            var window = new BackdropWindow();
            window.Initialize();

            var demoIndex = Array.IndexOf(args, "--demo");
            if (demoIndex >= 0)
            {
                var seconds = 6;
                if (demoIndex + 1 < args.Length && int.TryParse(args[demoIndex + 1], out var parsed))
                {
                    seconds = parsed;
                }
                var edge = "free";
                var edgeIndex = Array.IndexOf(args, "--edge");
                if (edgeIndex >= 0 && edgeIndex + 1 < args.Length)
                {
                    edge = args[edgeIndex + 1];
                }

                window.Enqueue(new BackdropCommand
                {
                    Cmd = "show",
                    X = 760,
                    Y = edge == "top" ? 0 : 120,
                    W = 400,
                    H = 72,
                    R = edge == "free" ? 36 : 18,
                    Edge = edge,
                    Tint = Array.IndexOf(args, "--clear") >= 0 ? 0.15 : 0.22,
                    Material = Array.IndexOf(args, "--clear") >= 0 ? "clear" : "regular",
                });

                var dumpIndex = Array.IndexOf(args, "--dump");
                var dumpDir = dumpIndex >= 0 && dumpIndex + 1 < args.Length ? args[dumpIndex + 1] : null;

                var timer = new Thread(() =>
                {
                    if (dumpDir != null)
                    {
                        Thread.Sleep(TimeSpan.FromMilliseconds(2500));
                        window.DumpRefraction(dumpDir);
                    }
                    Thread.Sleep(TimeSpan.FromSeconds(seconds));
                    window.Enqueue(new BackdropCommand { Cmd = "quit" });
                })
                {
                    IsBackground = true,
                };
                timer.Start();
            }
            else
            {
                window.StartStdinPump();
            }

            window.RunMessageLoop();
            return 0;
        }
        catch (Exception ex)
        {
            BackdropWindow.Log($"fatal: {ex}");
            return 1;
        }
    }
}
