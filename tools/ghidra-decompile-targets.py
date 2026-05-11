# -*- coding: utf-8 -*-
# Ghidra post-analysis script - Decompile specific functions by VA address
# @category Windsurf-Reverse

import os
from ghidra.app.decompiler import DecompInterface
from ghidra.util.task import ConsoleTaskMonitor

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(sourceFile.getAbsolutePath())), "..", "docs", "ghidra-output")
if not os.path.exists(OUTPUT_DIR):
    os.makedirs(OUTPUT_DIR)

fm = currentProgram.getFunctionManager()
space = currentProgram.getAddressFactory().getDefaultAddressSpace()

# Target functions with their VA addresses and Go symbol names
TARGETS = [
    (0x141D1D360, "cortex.(*CascadeManager).GetSystemPromptAndTools"),
    (0x141C0C3E0, "cortex/managers.(*PromptBuilder).Build"),
    (0x141C0C100, "cortex/managers.(*PromptBuilder).AddSections"),
    (0x141C08860, "cortex/managers.(*PlannerGenerator).Generate"),
    (0x141C061A0, "cortex/managers.(*PlannerGenerator).buildChatMessageRequest"),
    (0x141C00760, "cortex/managers.(*PlannerGenerator).handleToolCall"),
    (0x141ACD760, "prompt.DefaultCascadeSystemPromptForCumulativePrompt"),
    (0x141ACD440, "prompt.DefaultCascadeConfigForCumulativePrompt"),
    (0x141D10920, "cortex.(*CascadeManager).executeHelper"),
    (0x141D159A0, "cortex.(*CascadeManager).ExecuteOne"),
    (0x141D2A660, "cortex.CreateDefaultCascadeHandlerMap"),
    (0x141E7F300, "language_server.(*Server).GetSystemPromptAndTools"),
    (0x141BE9480, "cortex/managers.(*CascadePrReviewMixin).GetSystemPrompt"),
    (0x141BE9DE0, "cortex/managers.(*CascadeSmartLintMixin).GetSystemPrompt"),
    (0x141BD40E0, "language_server/cortex/nodes.(*ClusterQueryMixin).GetSystemPrompt"),
    (0x141BD5D20, "language_server/cortex/nodes.(*RelatedFilesMixin).GetSystemPrompt"),
    (0x141DC09A0, "language_server/vibe_and_replace.(*VibeEditToolConverter).GetToolDefinition"),
    (0x141DC1180, "language_server/vibe_and_replace.(*VibeEditToolConverter).GetUserFacingDescription"),
]

monitor = ConsoleTaskMonitor()
decomp = DecompInterface()
decomp.openProgram(currentProgram)

out_file = os.path.join(OUTPUT_DIR, "ghidra-target-decompiled.txt")
with open(out_file, "w") as f:
    for va, name in TARGETS:
        addr = space.getAddress(va)
        func = fm.getFunctionAt(addr)
        if not func:
            func = fm.getFunctionContaining(addr)
        
        if func:
            func_size = func.getBody().getNumAddresses()
            ghidra_name = func.getName(True)
            print("[+] Decompiling: %s (Ghidra: %s) @ 0x%X (%d bytes)" % (name, ghidra_name, va, func_size))
            
            f.write("=" * 80 + "\n")
            f.write("Go Symbol: %s\n" % name)
            f.write("Address: 0x%X (Ghidra: %s)\n" % (va, ghidra_name))
            f.write("Size: %d bytes\n" % func_size)
            f.write("=" * 80 + "\n")
            
            timeout = 120 if func_size > 5000 else 60
            dec_result = decomp.decompileFunction(func, timeout, monitor)
            if dec_result and dec_result.getDecompiledFunction():
                c_code = dec_result.getDecompiledFunction().getC()
                f.write(c_code[:30000])
            else:
                err = dec_result.getErrorMessage() if dec_result else "timeout"
                f.write("ERROR: %s\n" % err)
            f.write("\n\n")
        else:
            print("[!] No function at 0x%X for %s" % (va, name))
            f.write("=" * 80 + "\n")
            f.write("MISSING: %s @ 0x%X\n" % (name, va))
            f.write("=" * 80 + "\n\n")

print("[*] Done! Output: %s" % out_file)
