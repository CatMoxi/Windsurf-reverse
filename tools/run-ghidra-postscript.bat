@echo off
set JAVA_HOME=D:\Tools\jdk21\jdk-21.0.5+11
set PATH=%JAVA_HOME%\bin;%PATH%
call D:\Tools\ghidra\ghidra_11.3.2_PUBLIC\support\analyzeHeadless.bat d:\AGENT\Project_agent\Windsurf-reverse\ghidra-project WindsurfLS -process language_server_windows_x64.exe -noanalysis -postScript d:\AGENT\Project_agent\Windsurf-reverse\tools\ghidra-decompile-targets.py
