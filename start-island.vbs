' Silent Dynamic Island launcher (no console windows)
Set sh = CreateObject("WScript.Shell")
ps1 = "c:\Users\Dankov_S\ILON_MUSK_PROJECT_FIRE_GUN111\island\scripts\start-island-silent.ps1"
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """"
sh.Run cmd, 0, False
