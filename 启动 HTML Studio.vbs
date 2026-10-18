Set fs = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fs.GetParentFolderName(WScript.ScriptFullName)
exe = fs.BuildPath(root, "dist\HTML-Studio-0.3.0-win-x64\HTML Studio.exe")
shell.Run Chr(34) & exe & Chr(34), 1, False
