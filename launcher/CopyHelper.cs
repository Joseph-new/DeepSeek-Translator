using System;
using System.Runtime.InteropServices;

/// <summary>
/// 取词辅助程序：向当前前台窗口注入一次 Ctrl+C。
///
/// 为什么要单独做成 exe，而不是让主程序每次起一个 PowerShell：
///   1. PowerShell 进程冷启动本身要 300～500ms
///   2. 用 Add-Type 内联 C# 的话，还要在运行时编译一遍，再花 600～900ms
///      实测整套要 1300～1600ms，比程序等待剪贴板的窗口还长，于是取词失败
///   3. 用 SendKeys 倒是快，但从「无控制台的隐藏进程」里发键根本送不到目标窗口
///      （实测 0/6 成功率），而且不报任何错
///
/// 编译成一个几十 KB 的 exe 之后，调用只要几十毫秒，且用 keybd_event 注入
/// 是可靠送达的。源码里刻意不引用 System.Windows.Forms —— 编译更快，
/// 也不用拖一个 MessageBox 的依赖进来。
/// </summary>
static class CopyHelper
{
    [DllImport("user32.dll")]
    static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    const byte VK_CONTROL = 0x11;
    const byte VK_C = 0x43;
    const uint KEYEVENTF_KEYUP = 0x0002;

    [STAThread]
    static void Main()
    {
        keybd_event(VK_CONTROL, 0, 0, UIntPtr.Zero);
        keybd_event(VK_C, 0, 0, UIntPtr.Zero);
        keybd_event(VK_C, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    }
}
