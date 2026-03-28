Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public class KioskHook {
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_SYSKEYDOWN = 0x0104;

    private static IntPtr hookId = IntPtr.Zero;
    private static HookProc hookProc;

    private delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hhk);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string lpModuleName);

    public static void Install() {
        hookProc = HookCallback;
        hookId = SetWindowsHookEx(WH_KEYBOARD_LL, hookProc, GetModuleHandle(null), 0);
    }

    public static void Uninstall() {
        if (hookId != IntPtr.Zero) {
            UnhookWindowsHookEx(hookId);
            hookId = IntPtr.Zero;
        }
    }

    private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
        if (nCode >= 0) {
            int vkCode = Marshal.ReadInt32(lParam);
            if (vkCode == 91 || vkCode == 92) return (IntPtr)1;
            if (vkCode == 162 || vkCode == 163) return (IntPtr)1;
            if (vkCode == 164 || vkCode == 165) return (IntPtr)1;
            if ((int)wParam == WM_SYSKEYDOWN || (int)wParam == WM_KEYDOWN) {
                bool alt = (Control.ModifierKeys & Keys.Alt) != 0;
                if (alt && vkCode == 9) return (IntPtr)1;
                if (alt && vkCode == 27) return (IntPtr)1;
                if (alt && vkCode == 115) return (IntPtr)1;
            }
        }
        return CallNextHookEx(hookId, nCode, wParam, lParam);
    }
}
"@ -ReferencedAssemblies System.Windows.Forms

[KioskHook]::Install()
[Console]::Out.WriteLine("KIOSK_HOOK_ACTIVE")
[Console]::Out.Flush()

try {
    while ($true) {
        [System.Windows.Forms.Application]::DoEvents()
        Start-Sleep -Milliseconds 50
    }
} finally {
    [KioskHook]::Uninstall()
}
