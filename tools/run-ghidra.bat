@echo off
set JAVA_HOME=D:\Tools\jdk21\jdk-21.0.5+11
set PATH=%JAVA_HOME%\bin;%PATH%
call "D:\Tools\ghidra\ghidra_11.3.2_PUBLIC\support\analyzeHeadless.bat" "d:\AGENT\Project_agent\Windsurf-reverse\ghidra-project" "WindsurfLS" -import "D:\AGENT\Project_agent\Windsurf-reverse\windsurf-next\resources\app\extensions\windsurf\bin\language_server_windows_x64.exe" -postScript "d:\AGENT\Project_agent\Windsurf-reverse\tools\ghidra-export-functions.py" -analysisTimeoutPerFile 7200 -scriptlog "d:\AGENT\Project_agent\Windsurf-reverse\docs\ghidra-output\ghidra-script.log"
