# -*- coding: utf-8 -*-
# Ghidra post-analysis script - Parse Go pclntab to recover symbols
# Then decompile target functions
# @category Windsurf-Reverse

import os
import struct
from ghidra.app.decompiler import DecompInterface
from ghidra.util.task import ConsoleTaskMonitor

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(sourceFile.getAbsolutePath())), "..", "docs", "ghidra-output")
if not os.path.exists(OUTPUT_DIR):
    os.makedirs(OUTPUT_DIR)

fm = currentProgram.getFunctionManager()
mem = currentProgram.getMemory()
space = currentProgram.getAddressFactory().getDefaultAddressSpace()

def read_bytes(addr, length):
    buf = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, length)
    mem.getBytes(addr, buf)
    return bytes([(b & 0xFF) for b in buf])

def read_uint32(addr):
    data = read_bytes(addr, 4)
    return struct.unpack('<I', data)[0]

def read_uint64(addr):
    data = read_bytes(addr, 8)
    return struct.unpack('<Q', data)[0]

# Strategy: scan all memory for Go function name strings
# Go pclntab stores func name strings that we can match
# The strings in gopclntab area contain full Go symbol names

print("[*] Scanning binary for Go symbol name strings...")

# Read the .rdata section which contains Go strings
blocks = mem.getBlocks()
target_blocks = []
for block in blocks:
    name = block.getName()
    if name in ['.rdata', '.text', '.data']:
        print("[*] Block: %s start=%s size=%d" % (name, block.getStart(), block.getSize()))
        target_blocks.append(block)

# Search for Go symbol strings containing our target patterns
TARGET_SYMBOLS = [
    "cortex.(*CascadeManager).GetSystemPromptAndTools",
    "cortex/managers.(*CascadeConversationalMixin).GetSystemPrompt",
    "cortex/managers.(*CascadeAgentMixin).GetSystemPrompt",
    "cortex/managers.(*PromptBuilder).Build",
    "cortex/managers.(*PromptBuilder).AddSections",
    "cortex/managers.(*PlannerGenerator).Generate",
    "cortex/managers.(*PlannerGenerator).buildChatMessageRequest",
    "cortex/managers.(*PlannerGenerator).handleToolCall",
    "cortex/executors.(*CascadeExecutor).Execute",
    "cortex/executors.(*CascadeExecutor).handleStep",
    "cortex/handlers.(*RunCommandHandler).Handle",
    "cortex/handlers.(*ViewFileHandler).Handle",
    "prompt.(*SystemPromptElements).ToPromptWithLimit",
    "prompt.DefaultCascadeSystemPromptForCumulativePrompt",
    "prompt.defaultCascadeSystemPromptParts",
    "prompt/cumulative_prompt_handler.(*CumulativePromptHandler).ConstructCumulativePrompt",
    "language_server/vibe_and_replace.GenerateVibeAndReplace",
    "language_server.(*Server).GetSystemPromptAndTools",
    "cortex/utils/mcp.(*McpManager).Load",
]

# Find these strings in the binary to get their data addresses
print("[*] Searching for %d target symbol strings..." % len(TARGET_SYMBOLS))
found_strings = {}

for block in target_blocks:
    if block.getName() != '.rdata':
        continue
    start = block.getStart()
    block_size = block.getSize()
    
    # Read in chunks
    CHUNK = 0x1000000  # 16MB chunks
    offset = 0
    while offset < block_size:
        read_size = min(CHUNK, block_size - offset)
        addr = start.add(offset)
        try:
            data = read_bytes(addr, read_size)
        except:
            offset += CHUNK
            continue
        
        text = data.decode('utf-8', errors='replace')
        
        for sym in TARGET_SYMBOLS:
            if sym in found_strings:
                continue
            idx = text.find(sym)
            if idx >= 0:
                str_addr = addr.add(idx)
                found_strings[sym] = str_addr
                print("[+] Found: %s @ %s" % (sym, str_addr))
        
        offset += CHUNK

print("[*] Found %d / %d target strings" % (len(found_strings), len(TARGET_SYMBOLS)))

# Now try to use xrefs to find the actual code
# In Go, the pclntab has a table that maps PC values to function name offsets
# We need to find references to these string addresses from the pclntab structure

# Alternative: search for the function addresses by looking at the function table
# Go 1.16+ pclntab format:
# Magic (4 bytes) + padding (4) + ... + nfunc (8) + ... + func table entries

print("[*] Parsing Go pclntab to map function PCs...")

# Find pclntab magic 0xFFFFFFF0 (Go 1.16)
pclntab_addr = None
for block in target_blocks:
    start = block.getStart()
    block_size = block.getSize()
    CHUNK = 0x100000
    offset = 0
    while offset < block_size:
        read_size = min(CHUNK + 16, block_size - offset)
        addr = start.add(offset)
        try:
            data = read_bytes(addr, read_size)
        except:
            offset += CHUNK
            continue
        
        for i in range(len(data) - 8):
            if data[i] == 0xF0 and data[i+1] == 0xFF and data[i+2] == 0xFF and data[i+3] == 0xFF:
                pclntab_addr = addr.add(i)
                print("[*] Found Go 1.16 pclntab at %s" % pclntab_addr)
                break
            if data[i] == 0xFA and data[i+1] == 0xFF and data[i+2] == 0xFF and data[i+3] == 0xFF:
                candidate = addr.add(i)
                # Check if this looks like a real pclntab (next bytes should be version info)
                if data[i+4] == 0x00 and data[i+6] == 0x00:
                    pclntab_addr = candidate
                    print("[*] Found Go 1.2 pclntab at %s" % pclntab_addr)
                    break
        
        if pclntab_addr:
            break
        offset += CHUNK
    if pclntab_addr:
        break

if not pclntab_addr:
    print("[!] Could not find pclntab, falling back to brute force")
else:
    # Read pclntab header
    header = read_bytes(pclntab_addr, 64)
    magic = struct.unpack('<I', header[0:4])[0]
    print("[*] pclntab magic: 0x%08X" % magic)
    
    if magic == 0xFFFFFFF0:
        # Go 1.16 format
        # offset 8: quantum (1 byte), ptrsize (1 byte)
        quantum = header[6]
        ptrsize = header[7]
        nfunc = struct.unpack('<I', header[8:12])[0]
        nfiles = struct.unpack('<I', header[12:16])[0]
        
        # Offsets to subtables
        textStart_off = struct.unpack('<I', header[16:20])[0]
        funcnameOffset = struct.unpack('<I', header[20:24])[0]
        cuOffset = struct.unpack('<I', header[24:28])[0]
        filetabOffset = struct.unpack('<I', header[28:32])[0]
        pctabOffset = struct.unpack('<I', header[32:36])[0]
        pclnOffset = struct.unpack('<I', header[36:40])[0]
        
        print("[*] nfunc=%d nfiles=%d ptrsize=%d" % (nfunc, nfiles, ptrsize))
        print("[*] funcnameOffset=0x%X pclnOffset=0x%X" % (funcnameOffset, pclnOffset))
        
        # The funcname table starts at pclntab + funcnameOffset
        funcname_base = pclntab_addr.add(funcnameOffset)
        
        # The function table starts at pclntab + pclnOffset  
        # Each entry is: funcPC (uint, relative to textStart), funcdata offset
        functab_base = pclntab_addr.add(pclnOffset)
        
        # Read textStart
        textStart = read_uint64(pclntab_addr.add(textStart_off)) if textStart_off > 0 else 0
        
        print("[*] Dumping function name → PC mapping for target functions...")
        
        mapped = {}
        out_file = os.path.join(OUTPUT_DIR, "go-symbol-address-map.txt")
        with open(out_file, "w") as f:
            for i in range(min(nfunc, 100000)):
                try:
                    # Each functab entry: 4 bytes funcPC offset, 4 bytes funcdata offset
                    entry_addr = functab_base.add(i * 8)
                    entry = read_bytes(entry_addr, 8)
                    funcPC_off = struct.unpack('<I', entry[0:4])[0]
                    funcdata_off = struct.unpack('<I', entry[4:8])[0]
                    
                    # funcPC = textStart + funcPC_off (or funcPC_off itself as VA)
                    # funcdata contains name offset at a specific position
                    funcdata_addr = pclntab_addr.add(funcdata_off)
                    funcdata = read_bytes(funcdata_addr, 16)
                    
                    # In Go 1.16 _func structure:
                    # offset 0: entryOff (uint32, relative to textStart)  
                    # offset 4: nameOff (int32, relative to funcnameOffset)
                    entryOff = struct.unpack('<I', funcdata[0:4])[0]
                    nameOff = struct.unpack('<i', funcdata[4:8])[0]
                    
                    # Read function name
                    name_addr = funcname_base.add(nameOff)
                    name_bytes = read_bytes(name_addr, 256)
                    name = ""
                    for b in name_bytes:
                        if b == 0:
                            break
                        name += chr(b)
                    
                    # Calculate actual PC
                    # In Go 1.16, entryOff is relative to textStart in pclntab header
                    actual_pc = textStart + entryOff if textStart else entryOff
                    
                    line = "0x%X\t%s\n" % (actual_pc, name)
                    f.write(line)
                    
                    # Check if this is one of our targets
                    for target in TARGET_SYMBOLS:
                        short = target.split("exa/")[-1] if "exa/" in target else target
                        if short in name or target in name:
                            mapped[target] = (actual_pc, name)
                            print("[MATCH] 0x%X = %s" % (actual_pc, name))
                            break
                except Exception as e:
                    if i < 5:
                        print("[!] Error at func %d: %s" % (i, str(e)))
                    continue
        
        print("[*] Wrote %d function entries to %s" % (min(nfunc, 100000), out_file))
        print("[*] Matched %d target functions" % len(mapped))
        
        # Now decompile matched functions
        if mapped:
            monitor = ConsoleTaskMonitor()
            decomp_iface = DecompInterface()
            decomp_iface.openProgram(currentProgram)
            
            decomp_file = os.path.join(OUTPUT_DIR, "ghidra-target-decompiled.txt")
            with open(decomp_file, "w") as df:
                for target, (pc, name) in sorted(mapped.items()):
                    ghidra_addr = space.getAddress(pc)
                    func = fm.getFunctionContaining(ghidra_addr)
                    if not func:
                        func = fm.getFunctionAt(ghidra_addr)
                    
                    if func:
                        func_size = func.getBody().getNumAddresses()
                        print("[*] Decompiling %s @ 0x%X (%d bytes)" % (name, pc, func_size))
                        
                        df.write("=" * 80 + "\n")
                        df.write("Go Symbol: %s\n" % name)
                        df.write("Address: 0x%X (Ghidra: %s)\n" % (pc, func.getName(True)))
                        df.write("Size: %d bytes\n" % func_size)
                        df.write("=" * 80 + "\n")
                        
                        timeout = 120 if func_size > 10000 else 60
                        dec_result = decomp_iface.decompileFunction(func, timeout, monitor)
                        if dec_result and dec_result.getDecompiledFunction():
                            c_code = dec_result.getDecompiledFunction().getC()
                            df.write(c_code[:20000])
                        else:
                            err = dec_result.getErrorMessage() if dec_result else "timeout"
                            df.write("ERROR: %s\n" % err)
                        df.write("\n\n")
                    else:
                        print("[!] No function at 0x%X for %s" % (pc, name))
    
    elif magic == 0xFFFFFFA:
        print("[*] Go 1.2 format - not implemented yet")

print("[*] All done!")
