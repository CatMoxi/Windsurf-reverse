# Ghidra post-analysis script - Recover Go symbols from gopclntab
# Then decompile key functions by name
# @category Windsurf-Reverse

import os
import json
import struct
from ghidra.app.decompiler import DecompInterface
from ghidra.util.task import ConsoleTaskMonitor
from ghidra.program.model.symbol import SourceType

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(sourceFile.getAbsolutePath())), "..", "docs", "ghidra-output")
if not os.path.exists(OUTPUT_DIR):
    os.makedirs(OUTPUT_DIR)

fm = currentProgram.getFunctionManager()
mem = currentProgram.getMemory()
addr_factory = currentProgram.getAddressFactory()
space = addr_factory.getDefaultAddressSpace()

print("[*] Attempting to parse Go pclntab for symbol recovery...")

# Find pclntab by searching for known magic bytes
# Go 1.16: 0xFFFFFFF0, Go 1.18: 0xFFFFFFF1, Go 1.2: 0xFFFFFFFB  
def find_pclntab():
    magics = [
        ([0xF0, 0xFF, 0xFF, 0xFF], "Go 1.16"),
        ([0xF1, 0xFF, 0xFF, 0xFF], "Go 1.18+"),
        ([0xFA, 0xFF, 0xFF, 0xFF], "Go 1.2"),
        ([0xFB, 0xFF, 0xFF, 0xFF], "Go 1.2 (alt)"),
    ]
    
    blocks = mem.getBlocks()
    for block in blocks:
        if not block.isLoaded():
            continue
        start = block.getStart()
        end = block.getEnd()
        size = end.subtract(start) + 1
        if size < 16:
            continue
        
        buf = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, min(size, 0x1000000))
        mem.getBytes(start, buf)
        
        for magic, version in magics:
            for i in range(len(buf) - 8):
                b0 = buf[i] & 0xFF
                b1 = buf[i+1] & 0xFF
                b2 = buf[i+2] & 0xFF
                b3 = buf[i+3] & 0xFF
                if b0 == magic[0] and b1 == magic[1] and b2 == magic[2] and b3 == magic[3]:
                    addr = start.add(i)
                    print("[*] Found pclntab magic (%s) at %s" % (version, addr))
                    return addr, version
    return None, None

# Alternative approach: use the symbol table from go-symbols file
# Map Go symbol names to Ghidra function addresses
def load_go_symbols_and_map():
    """Read Go symbol names and try to find matching functions by address"""
    symbols_file = os.path.join(os.path.dirname(os.path.abspath(sourceFile.getAbsolutePath())), "go-symbols-exafunction.txt")
    if not os.path.exists(symbols_file):
        print("[!] go-symbols-exafunction.txt not found")
        return {}
    
    symbols = []
    with open(symbols_file, "r") as f:
        for line in f:
            line = line.strip()
            if line:
                symbols.append(line)
    print("[*] Loaded %d Go symbols from file" % len(symbols))
    return symbols

# Target functions to decompile (with Go symbol name patterns)
TARGET_FUNCTIONS = [
    "CascadeExecutor).Execute",
    "CascadeConversationalMixin).GetSystemPrompt",
    "CascadeAgentMixin).GetSystemPrompt",
    "PlannerGenerator).Generate",
    "PlannerGenerator).buildChatMessageRequest",
    "PlannerGenerator).handleToolCall",
    "PromptBuilder).Build",
    "PromptBuilder).AddSections",
    "SystemPromptElements).ToPromptWithLimit",
    "DefaultCascadeSystemPromptForCumulativePrompt",
    "defaultCascadeSystemPromptParts",
    "CumulativePromptHandler).ConstructCumulativePrompt",
    "RunCommandHandler).Handle",
    "ViewFileHandler).Handle",
    "EditFileToolConverter",
    "McpManager).Load",
    "VibeEditToolConverter",
    "GenerateVibeAndReplace",
]

# Since we can't directly map Go symbols to addresses without nm output,
# let's try another approach: search strings in the binary and find xrefs
print("[*] Strategy: Search for key string constants and trace to functions")

monitor = ConsoleTaskMonitor()
decomp = DecompInterface()
decomp.openProgram(currentProgram)

# Search for defined strings matching our targets
from ghidra.program.util import DefinedDataIterator

results = {}
keyword_strings = [
    "communication_style",
    "making_code_changes", 
    "tool_calling",
    "user_rules",
    "running_commands",
    "You are Cascade",
    "coding assistant",
    "pair programming",
    "ENTER ANALYSIS MODE",
    "SafeToAutoRun",
    "restricted_exec",
    "SEARCH/REPLACE",
]

print("[*] Searching for %d keyword strings..." % len(keyword_strings))
string_ref_file = os.path.join(OUTPUT_DIR, "ghidra-string-xrefs.txt")
decompiled_from_strings = os.path.join(OUTPUT_DIR, "ghidra-decompiled-from-strings.txt")

found_functions = set()

with open(string_ref_file, "w") as sf, open(decompiled_from_strings, "w") as df:
    for data in DefinedDataIterator.definedStrings(currentProgram):
        val = data.getDefaultValueRepresentation()
        if not val or len(val) < 10:
            continue
        
        matched_kw = None
        for kw in keyword_strings:
            if kw.lower() in val.lower():
                matched_kw = kw
                break
        
        if not matched_kw:
            continue
        
        addr = data.getAddress()
        sf.write("\n=== STRING '%s' @ %s ===\n" % (matched_kw, addr))
        sf.write("Full value: %s\n" % val[:500])
        
        # Find all references to this string
        refs = getReferencesTo(addr)
        for ref in refs:
            from_addr = ref.getFromAddress()
            containing_func = fm.getFunctionContaining(from_addr)
            if containing_func:
                func_name = containing_func.getName(True)
                func_addr = containing_func.getEntryPoint()
                func_size = containing_func.getBody().getNumAddresses()
                sf.write("  -> Ref from: %s @ %s (%d bytes)\n" % (func_name, func_addr, func_size))
                
                # Decompile if not already done
                func_key = str(func_addr)
                if func_key not in found_functions and func_size > 50:
                    found_functions.add(func_key)
                    print("[+] Decompiling %s (refs '%s')" % (func_name, matched_kw))
                    
                    dec_result = decomp.decompileFunction(containing_func, 60, monitor)
                    df.write("=" * 80 + "\n")
                    df.write("Function: %s @ %s (%d bytes)\n" % (func_name, func_addr, func_size))
                    df.write("Referenced string: %s\n" % matched_kw)
                    df.write("=" * 80 + "\n")
                    
                    if dec_result and dec_result.getDecompiledFunction():
                        c_code = dec_result.getDecompiledFunction().getC()
                        df.write(c_code[:10000])  # Limit output size
                    else:
                        err = dec_result.getErrorMessage() if dec_result else "timeout"
                        df.write("ERROR: %s\n" % err)
                    df.write("\n\n")

print("[*] Found %d unique functions referencing keyword strings" % len(found_functions))
print("[*] Done!")
