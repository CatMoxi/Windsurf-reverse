# Ghidra headless post-analysis script
# Exports decompiled output for target functions
# Usage: analyzeHeadless.bat <projDir> <projName> -import <binary> -postScript ghidra-export-functions.py
# @category Windsurf-Reverse

import os
import json
from ghidra.app.decompiler import DecompInterface
from ghidra.util.task import ConsoleTaskMonitor

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(sourceFile.getAbsolutePath())), "..", "docs", "ghidra-output")
if not os.path.exists(OUTPUT_DIR):
    os.makedirs(OUTPUT_DIR)

# Target function patterns to decompile
TARGET_PATTERNS = [
    "GetSystemPromptAndTools",
    "GetSystemPrompt",
    "applyUnleashSystemPromptSectionOverrideConfig",
    "getSystemPrompt",
    "FormatSystemPrompt",
    "CascadeConversationalMixin",
    "CascadeAgentMixin",
    "CascadeManager",
    "GetToolConverters",
    "GetToolOptions",
    "ShouldTerminate",
    "TrajectoryToChatMessages",
    "GetEphemeralMessage",
    "executeCortexStep",
    "runCortexLoop",
    "handleBrainUpdate",
    "checkExperiment",
    "impersonate_tier",
    "checkRateLimit",
    "CheckUserMessageRateLimit",
    "GetCascadeModelConfigs",
    "RegisterUser",
]

def should_decompile(func_name):
    for pat in TARGET_PATTERNS:
        if pat.lower() in func_name.lower():
            return True
    return False

monitor = ConsoleTaskMonitor()
decomp = DecompInterface()
decomp.openProgram(currentProgram)

# Collect all functions
fm = currentProgram.getFunctionManager()
func_iter = fm.getFunctions(True)
total = fm.getFunctionCount()
matched = 0
results = {}

print("[*] Total functions: %d" % total)
print("[*] Scanning for target functions...")

for func in func_iter:
    name = func.getName(True)  # Include namespace
    if should_decompile(name):
        matched += 1
        addr = func.getEntryPoint()
        print("[+] Decompiling: %s @ %s" % (name, addr))
        
        dec_result = decomp.decompileFunction(func, 30, monitor)
        if dec_result and dec_result.depiledFunction():
            c_code = dec_result.getDecompiledFunction().getC()
            results[name] = {
                "address": str(addr),
                "size": func.getBody().getNumAddresses(),
                "decompiled": c_code
            }
        else:
            err = dec_result.getErrorMessage() if dec_result else "timeout"
            results[name] = {
                "address": str(addr),
                "size": func.getBody().getNumAddresses(),
                "error": err
            }

print("[*] Matched %d functions" % matched)

# Save results
out_file = os.path.join(OUTPUT_DIR, "decompiled-functions.json")
with open(out_file, "w") as f:
    json.dump(results, f, indent=2)
print("[*] Saved to %s" % out_file)

# Also save a readable text version
txt_file = os.path.join(OUTPUT_DIR, "decompiled-functions.txt")
with open(txt_file, "w") as f:
    for name, data in sorted(results.items()):
        f.write("=" * 80 + "\n")
        f.write("Function: %s\n" % name)
        f.write("Address:  %s\n" % data["address"])
        f.write("Size:     %d bytes\n" % data.get("size", 0))
        f.write("-" * 80 + "\n")
        if "decompiled" in data:
            f.write(data["decompiled"])
        else:
            f.write("ERROR: %s\n" % data.get("error", "unknown"))
        f.write("\n\n")
print("[*] Saved readable version to %s" % txt_file)

# Export all Exafunction function names with addresses
symbols_file = os.path.join(OUTPUT_DIR, "all-exafunction-symbols.txt")
with open(symbols_file, "w") as f:
    func_iter2 = fm.getFunctions(True)
    count = 0
    for func in func_iter2:
        name = func.getName(True)
        if "Exafunction" in name or "exa/" in name:
            f.write("%s\t%s\t%d\n" % (func.getEntryPoint(), name, func.getBody().getNumAddresses()))
            count += 1
    print("[*] Exported %d Exafunction symbols" % count)
print("[*] Done!")
