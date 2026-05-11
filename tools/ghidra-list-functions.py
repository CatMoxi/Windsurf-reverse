# Ghidra post-analysis script - List all function names to understand naming
# @category Windsurf-Reverse

import os

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(sourceFile.getAbsolutePath())), "..", "docs", "ghidra-output")
if not os.path.exists(OUTPUT_DIR):
    os.makedirs(OUTPUT_DIR)

fm = currentProgram.getFunctionManager()
total = fm.getFunctionCount()
print("[*] Total functions: %d" % total)

# Dump first 200 function names to understand naming pattern
out_file = os.path.join(OUTPUT_DIR, "ghidra-function-names-sample.txt")
with open(out_file, "w") as f:
    func_iter = fm.getFunctions(True)
    count = 0
    for func in func_iter:
        name = func.getName(True)
        addr = func.getEntryPoint()
        size = func.getBody().getNumAddresses()
        f.write("%s\t%s\t%d\n" % (addr, name, size))
        count += 1
        if count <= 20:
            print("[sample] %s @ %s (%d bytes)" % (name, addr, size))
    print("[*] Total listed: %d" % count)

# Also try to find functions by searching all strings for Go symbol references
print("[*] Searching for large functions (likely Go methods)...")
large_file = os.path.join(OUTPUT_DIR, "ghidra-large-functions.txt")
with open(large_file, "w") as f:
    func_iter2 = fm.getFunctions(True)
    large_count = 0
    for func in func_iter2:
        size = func.getBody().getNumAddresses()
        if size > 5000:  # Only large functions
            name = func.getName(True)
            addr = func.getEntryPoint()
            f.write("%s\t%s\t%d\n" % (addr, name, size))
            large_count += 1
            if large_count <= 10:
                print("[large] %s @ %s (%d bytes)" % (name, addr, size))
    print("[*] Large functions (>5KB): %d" % large_count)

# Try to decompile largest functions
from ghidra.app.decompiler import DecompInterface
from ghidra.util.task import ConsoleTaskMonitor

monitor = ConsoleTaskMonitor()
decomp = DecompInterface()
decomp.openProgram(currentProgram)

# Find the top 20 largest functions and decompile them
print("[*] Finding and decompiling top 20 largest functions...")
func_sizes = []
func_iter3 = fm.getFunctions(True)
for func in func_iter3:
    size = func.getBody().getNumAddresses()
    if size > 10000:
        func_sizes.append((size, func))

func_sizes.sort(key=lambda x: -x[0])
top_funcs = func_sizes[:20]

decomp_file = os.path.join(OUTPUT_DIR, "ghidra-top-decompiled.txt")
with open(decomp_file, "w") as f:
    for size, func in top_funcs:
        name = func.getName(True)
        addr = func.getEntryPoint()
        print("[decompile] %s @ %s (%d bytes)" % (name, addr, size))
        f.write("=" * 80 + "\n")
        f.write("Function: %s @ %s (%d bytes)\n" % (name, addr, size))
        f.write("=" * 80 + "\n")
        
        dec_result = decomp.decompileFunction(func, 60, monitor)
        if dec_result and dec_result.getDecompiledFunction():
            c_code = dec_result.getDecompiledFunction().getC()
            f.write(c_code)
        else:
            err = dec_result.getErrorMessage() if dec_result else "timeout"
            f.write("ERROR: %s\n" % err)
        f.write("\n\n")

# Search for functions containing string references to key prompts
print("[*] Searching for string references to system prompt keywords...")
from ghidra.program.util import DefinedDataIterator

string_refs_file = os.path.join(OUTPUT_DIR, "ghidra-prompt-string-refs.txt")
with open(string_refs_file, "w") as f:
    keywords = ["You are Cascade", "communication_style", "making_code_changes", 
                "tool_calling", "user_rules", "GetSystemPrompt", "PromptBuilder"]
    
    for data in DefinedDataIterator.definedStrings(currentProgram):
        val = data.getDefaultValueRepresentation()
        if val and len(val) > 10:
            for kw in keywords:
                if kw.lower() in val.lower():
                    addr = data.getAddress()
                    f.write("STRING @ %s: %s\n" % (addr, val[:200]))
                    
                    # Find references to this string
                    refs = getReferencesTo(addr)
                    for ref in refs:
                        from_addr = ref.getFromAddress()
                        containing_func = fm.getFunctionContaining(from_addr)
                        if containing_func:
                            f.write("  -> Referenced by: %s @ %s\n" % (
                                containing_func.getName(True), from_addr))
                    break

print("[*] Done!")
