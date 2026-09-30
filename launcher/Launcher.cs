using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

/// <summary>
/// DeepSeek 翻译器 · 启动器
///
/// 编译为 winexe（无控制台窗口），带自定义图标，启动同目录下的 Electron 运行时。
/// 相比 .vbs 启动器的好处：
///   1. 文件类型是 exe，Windows 会正常显示我们自己的图标和名称
///      （.vbs 永远只能显示系统自带的脚本图标，改不了）
///   2. 能可靠地清掉 ELECTRON_RUN_AS_NODE
/// </summary>
static class Launcher
{
    [STAThread]
    static void Main()
    {
        try
        {
            Run();
        }
        catch (Exception ex)
        {
            // 启动器崩了要让人看见，不能静默退出
            MessageBox.Show(
                "启动失败：\n\n" + ex.GetType().Name + ": " + ex.Message +
                "\n\n可以改用同目录下的「启动翻译器.vbs」启动。",
                "DeepSeek 翻译器",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    static void Run()
    {
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string electron = Path.Combine(baseDir, @"node_modules\electron\dist\electron.exe");

        if (!File.Exists(electron))
        {
            MessageBox.Show(
                "找不到 Electron 运行时。\n\n请先双击 start.bat 安装依赖。",
                "DeepSeek 翻译器",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return;
        }

        CleanUpEnvironment();

        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = electron;
        // Electron 接受应用目录作为参数；结尾不能带反斜杠，否则会把引号转义掉
        psi.Arguments = "\"" + baseDir.TrimEnd('\\') + "\"";
        psi.WorkingDirectory = baseDir;
        psi.UseShellExecute = false;

        Process.Start(psi);
    }

    /// <summary>
    /// 在启动子进程之前把「当前进程」的环境改干净。
    ///
    /// 1) 删掉 ELECTRON_RUN_AS_NODE。
    ///    必须真正删除 —— 这个变量只要存在（哪怕值是空字符串），
    ///    electron.exe 就会退化成纯 Node，程序起不来还报一堆莫名其妙的错。
    ///
    /// 2) 去掉「仅大小写不同」的重复环境变量。
    ///    ProcessStartInfo.EnvironmentVariables 内部是大小写不敏感的
    ///    StringDictionary；环境里同时存在 HTTP_PROXY 和 http_proxy 时，
    ///    .NET 构造这个字典会直接抛 ArgumentException，启动器崩溃 ——
    ///    而且因为编译成了 winexe（没有控制台），用户什么都看不到。
    ///    代理类工具（v2ray 等）经常同时设两组，而要用翻译工具的人
    ///    往往正开着代理，所以这个坑很容易撞上。
    ///
    /// 注意：这里刻意不碰 psi.EnvironmentVariables —— 连读它都会抛。
    /// 改成直接修当前进程的环境，子进程自然继承一份干净的副本。
    /// </summary>
    static void CleanUpEnvironment()
    {
        RemoveVariable("ELECTRON_RUN_AS_NODE");

        try
        {
            IDictionary env = Environment.GetEnvironmentVariables(EnvironmentVariableTarget.Process);
            HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            List<string> duplicates = new List<string>();

            foreach (DictionaryEntry entry in env)
            {
                string key = entry.Key as string;
                if (key == null) continue;
                if (!seen.Add(key)) duplicates.Add(key);
            }

            foreach (string key in duplicates) RemoveVariable(key);
        }
        catch (Exception)
        {
            // 环境变量枚举失败不该拦住启动，继续往下走
        }
    }

    static void RemoveVariable(string name)
    {
        try
        {
            Environment.SetEnvironmentVariable(name, null, EnvironmentVariableTarget.Process);
        }
        catch (Exception)
        {
            // 删不掉就算了，不能因此不启动
        }
    }
}
