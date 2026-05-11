# Cascade Tool Descriptions - Extracted from Go Binary

Total tools found: **33**

## edit
*Offset: 55940762*

```
Performs exact string replacements in files.

Usage:
- You must use your `Read` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file.
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if `old_string` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use `replace_all` to change every instance of `old_string`.
- Use `replace_all` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.
- The edit will FAIL if `old_string` and `new_string` are identical. This is considered a no-op and will throw an error.
- Include an `explanation` field to describe the change you are making.
```

---

## multi_edit
*Offset: 55988524*

```
This is a tool for making multiple edits to a single file in one operation. It allows you to perform multiple find-and-replace operations efficiently. When editing text, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.

To make multiple file edits, provide the following:
1.edits: An array of edit operations to perform, where each edit contains:
	- old_string: The text to replace(must match the file contents exactly, including all whitespace and indentation)
	- new_string: The edited text to replace the old_string
	- replace_all: Replace all occurrences of old_string.This parameter is optional and defaults to false.

IMPORTANT:
- All edits are applied in sequence, in the order they are provided
- Each edit operates on the result of the previous edit
- All edits must be valid for the operation to succeed - if any edit fails, none will be applied
- This tool is ideal when you need to make several changes to different parts of the same file

CRITICAL REQUIREMENTS:
1.Plan your edits carefully to avoid conflicts between sequential operations

WARNING:
- The tool will fail if edits.old_string doesn\'t match the file contents exactly (including whitespace)
- The tool will fail if edits.old_string and edits.new_string are the same
- Since edits are applied in sequence, ensure that earlier edits don\'t affect the text that later edits are trying to find

When making edits:
- Ensure all edits result in idiomatic, correct code
- Do not leave the code in a broken state
- Only use emojis if the user explicitly requests it.Avoid adding emojis to files unless asked.
- Use replace_all for replacing and renaming strings across the file.This parameter is useful if you want to rename a variable for instance.
```

---

## view_file / read_file
*Offset: 55901584*

```
Reads a file at the specified path.
This tool is only able to read files in the workspace that are not gitignored.
If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, reads 100 lines starting from line 1. Use offset/limit to read different sections or more lines.
- Any lines longer than %d characters will be truncated
- Text files are returned with 1-indexed line numbers in cat -n format
- The response includes full_length so you know the total file size
- You have the capability to call multiple tools in a single response. It is always better to speculatively read multiple files as a batch that are potentially useful.;; Basic function definitions
(
  (comment)* @doc
  .
  (function_definition
    type: (_)? @codeium.return_type
    declarator: (function_declarator
      declarator: (identifier) @name
      parameters: (parameter_list) @codeium.parameters
    )
    body: (_)? @body
  ) @definition.function
  (#select-adjacent! @doc @definition.function)
)

;; Function to pointer
(
  (comment)* @doc
  .
  (function_definition
    type: (_)? @codeium.return_type
    declarator: (pointer_declarator
      declarator: (function_declarator
        declarator: (identifier) @name
        parameters: (parameter_list) @codeium.parameters
      )
    )
    body: (_)? @body
  ) @definition.function
  (#select-adjacent! @doc @definition.function)
)

;; Imports

(
  (preproc_include
    path: (_) @name
  ) @definition.import
)
ENTER ANALYSIS MODE

DONT TAKE ANY ACTIONS. ONLY OUTPUT YOUR ANALYSIS FOLLOWING THE PROVIDED FORMAT

Generate a short conversation title around 3-5 words describing the USER's intent and goals during this chat. Should be title-cased, e.g 'Developing a Chess App'. Format as a simple string, not as markdown; and please output the title directly, do not prefix it with "Title:" or an
```

---

## write_to_file
*Offset: 55845286*

```
Use this tool to create new files. The file and any parent directories will be created for you if they do not already exist.
		Follow these instructions:
		1. NEVER use this tool to modify or overwrite existing files. Always first confirm that TargetFile does not exist before calling this tool.
		2. You MUST specify the full TargetFile before any of the code contents.Estimated total CPU time spent performing GC tasks on spare CPU resources that the Go scheduler could not otherwise find a use for. This should be subtracted from the total GC CPU time to obtain a measure of compulsory GC CPU time. This metric is an overestimate, and not directly comparable to system CPU time measurements. Compare only with other /cpu/classes metrics.Translate the following code into %[1]s obeying the following instructions:
- Keep the code as close to the original as possible
- Make the code functional in %[1]s
- The output should be in %[1]s with as few changes as possible
- Keep all non-code comments and docstrings as close to the original as possible
Here is an example of translating from python to typescript:
Reflect and update the plan that needs to be followed to accomplish the task at hand. This should be called whenever new information is received, either from the user, or from performing research, that changes the course of action that should be taken. Take into account the update reason when updating the plan. You should NEVER call this tool multiple times in parallel.Ask the user a question with predefined options. Use this when you need the user to make a choice between specific options.
You can provide up to 4 options, each with a label and description.
NEVER include "other" as an option - the user can always automatically provide a custom response.
Set allowMultiple to true if the user should be able to select more than one option.You are an expert AI coding assistant and are pair programming with a USER to solve a coding task. When asked, you focus on outlining the USER'
```

---

## run_command
*Offset: 55898418*

```
PROPOSE a command to run on behalf of the user. Operating System: %s. Shell: %s.
**NEVER PROPOSE A cd COMMAND**.
If you have this tool, note that you DO have the ability to run commands directly on the USER's system.
Make sure to specify CommandLine exactly as it should be run in the shell.
Note that the user will have to approve the command before it is executed. The user may reject it if it is not to their liking.
The actual command will NOT execute until the user approves it. The user may not approve it immediately.
If the step is WAITING for user approval, it has NOT started running.
Commands will be run with PAGER=cat. You may want to limit the length of output for commands that usually rely on paging and may contain very long output (e.g. git log, use git log -n <N>).{
      "id": "string", // id of the trace: "1", "2", "3", ...
      "title": "string", // each trace should be 2-10 locations; don't split what could've been a single trace into multiple traces
      "description": "string", // short subtitle, discuss what service this is part of & how it relates to other traces
      "locations": [  // a sequence of 3-8 locations that map out control flow or data flow in order
        {
          "id": "string", // id of the location: 3a, 3b, 3c, 3d, 3e ... (if the trace id is 3)
          "lineContent": "string", // basic properties identifying the line
          "path": "string", // use absolute paths
          "lineNumber": number,
          "title": "string", // short title
          "description": "string" // subtitle
        }
      ]
    }View the contents of a file. The lines of the file are 1-indexed, and the output of this tool call will be the file contents from StartLine to EndLine (inclusive)%s. Note that this call can view at most %d lines at a time.

When using this tool to gather information, it's your responsibility to ensure you have the COMPLETE context. Specifically, each time you call this command you should:
1) Assess if the file contents y
```

---

## command_status
*Offset: 55860977*

```
Check the status of a previously started terminal command by its ID. Returns the current status (running or done), output lines as specified by output priority, and any error if present. If WaitDurationSeconds is specified, this tool will also wait up to that many seconds for the command to finish. Otherwise, this tool will directly return the current status of the command. Do not try to check the status of any IDs other than Background command IDs.
```

---

## grep_search
*Offset: 55355704*

```
A powerful search tool built on ripgrepVibe and replace LLM generation took %vCurrent number of scrapes being served.failed to check if directory exists: %s5. Add error handling for invalid files3. Refactor components to use variables- Never mix monospace and bold markers.Model Override not defined for model %sFailed to create global memory file: %vMemory to be deleted does not exist: %ssource path must end with .cursor/rulesFailed to delete old worktree at %s: %vdocument %s is not in base directory %sAdding CCIs for local directory file %sMigrating cascadeModelExplicitlySet: %vGITHUB_PULL_REQUEST_BRANCH_STATUS_DRAFTconnect> Unhandled HTTP status, got: %dntlm> Could not read challenge response%s %s giving up after %d attempt(s): %wcannot decode node with unknown kind %dunknown problem generating YAML contentcannot marshal invalid UTF-8 data as %scannot encode node with unknown kind %dfound an incorrect trailing UTF-8 octetdid not find expected hexdecimal numberecdsa: unsupported curve by crypto/ecdhmath/big: buffer too small to fit valueecdsa: public key point is the infinityecdsa: private key does not match curvecrypto/rsa: invalid options for Decryptcipher: incorrect tag size given to GCMcrypto/cipher: incorrect GCM nonce sizecrypto/cipher: GCM nonce prefix changedIPv4 field must have at least one digitinvalid character %q at start of stringgoogle.golang.org/genproto/protobuf/apigoogle.golang.org/protobuf/types/known/tags don't match (%d vs %+v) %+v %s @%dasn1: Unmarshal recipient value is nil missing argument to repetition operatortrailing backslash at end of expressioninvalid GOAMD64: must be v1, v2, v3, v4openpgp: unknown critical packet type: x448: the public key has the wrong sizeinvalid argon2 params: parallelism is 0%v: MessageSet with no extensions fieldinvalid value: merging into nil message(<\/?[^\s<>=\d"']+)(?:\s(.|\n)*?\/?>|>)(?m)^[.'][ \t]*SH +(?:[^"\s]+|"[^"\s]+)(^|/)CITATION(\.cff|(S)?(\.(bib|md))?)$(^|/)test/.*(Test(s?)|Spec(s?))\.scala$theme.GridS
```

---

## find_by_name
*Offset: 55868945*

```
Search for files and subdirectories within a specified directory using fd.
Search uses smart case and will ignore gitignored files by default.
Pattern and Excludes both use the glob format. If you are searching for Extensions, there is no need to specify both Pattern AND Extensions.
To avoid overwhelming output, the results are capped at 50 matches. Use the various arguments to filter the search scope as needed.
Results will include the type, size, modification time, and relative path.Estimated total CPU time spent with the application paused by the GC. Even if only one thread is running during the pause, this is computed as GOMAXPROCS times the pause latency because nothing else can be executing. This is the exact sum of samples in /sched/pauses/total/gc:seconds if each sample is multiplied by GOMAXPROCS at the time it is taken. This metric is an overestimate, and not directly comparable to system CPU time measurements. Compare only with other /cpu/classes metrics.The following is an outline of the file. The start and end of the document may not be included if the document is too long,
		but they are noted as %s and %s. Most of the functions and classes are summarized with approximate line ranges, and other lines are abridged.
		Some lines from the file are presented verbatim, in between the %s and %s tags. Only the lines within these tags are exactly as they are in the file.
		None of the other lines in this outline are verbatim from the file.

Now regenerate the codemap description based on the new traces. Keep it similar to the original description, taking changes into account.
The original prompt was "write a very brief description of the scope of the map, followed by a very brief sentence containing quick links to a few notable locations (reference them like [3b] or [6c])"

Always respond in the user's language.

Output your description within this XML tag:

<CODEMAP_DESCRIPTION>
[your description here]
</CODEMAP_DESCRIPTION>
View the content of a code item no
```

---

## code_search (Fast Context)
*Offset: 55929042*

```
search subagent the user refers to as 'Fast Context' that is ideal for exploring the codebase based on a request. This tool invokes a subagent that runs parallel grep and readfile calls over multiple turns to locate line ranges and files which might be relevant to the request. The search term should be a targeted natural language query based on what you are trying to accomplish, like 'Find where authentication requests are handled in the Express routes' or 'Modify the agentic rollout to use the new tokenizer and chat template' or 'Fix the bug where the user gets redirected from the /feed page'.  Fill out extra details that you as a smart model can infer in the question if necessary. You should always use this tool to start your search. Note: The files and line ranges returned by this tool may be some of the ones needed to complete the user's request, but you should be careful in evaluating the relevance of the results, since the subagent might make mistakes. You should consider using classical search tools afterwards to locate the rest if necessary. IMPORTANT: YOU CANNOT CALL THIS TOOL IN PARALLEL.^((ftp|tcp|udp|wss?|https?):\/\/)?(\S+(:\S*)?@)?((([1-9]\d?|1\d\d|2[01]\d|22[0-3]|24\d|25[0-5])(\.(\d{1,2}|1\d\d|2[0-4]\d|25[0-5])){2}(?:\.([0-9]\d?|1\d\d|2[0-4]\d|25[0-5]))|(\[(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\])|(([a-zA-Z0-9]([a-zA-Z0-9-_]+)?[a-zA-Z0-9]([-\
```

---

## browser_preview
*Offset: 55582361*

```
Spin up a browser preview for a web server- Do not amend a commit unless explicitly requested to do so.max batch tokens %d, query tokens %d, system prompt tokens %dntlm> Unable to acquire supplied or current user credentials.internal error: unexpected tail comment event (please report)ReverseProxy must have exactly one of Director or Rewrite setlookupUserPrimaryGroup: should be domain account type, not %d(?m)^[.'][ \t]*Dt +(?:[^"\s]+|"[^"]+") +"?(?:[1-9]|@[^\s@]+@)(?m)^[.'][ \t]*TH +(?:[^"\s]+|"[^"]+") +"?(?:[1-9]|@[^\s@]+@)(?m)\b(program|version)\s+\w+\s*{|\bunion\s+\w+\s+switch\s*\(*************************************************************System.Runtime.InteropServices.DefaultParameterValueAttribute_tableFlags.delegateTableViewWillDisplayCellForRowAtIndexPath<http://obeautifulcode.com/R/How-R-Searches-And-Finds-Stuff/>Lorg/apache/harmony/javax/security/auth/SubjectDomainCombiner//localhost/Users/hubery/Public/ucar/Document/Functions/Built// This is a generated file. Not intended for manual editing.Received a HEADERS frame with :method %q which should be POST[%s] (rollout %d of %d) halted on code action, proposing codexml: EncodeToken of Directive containing wrong < or > markers/exa.analytics_pb.AnalyticsService/RecordCortexTrajectoryStep/exa.user_analytics_pb.UserAnalyticsService/UserPageAnalytics[POST /{account_slug}/sites][%d] createSiteInTeamCreated  %+v[GET /sites/{site_id}/assets][%d] listSiteAssets default  %+v[GET /sites/{site_id}/builds][%d] listSiteBuilds default  %+vCumulative sum of heap memory freed by the garbage collector.The number of bytes of stack that were scanned last GC cycle.Memory that is reserved for or used to hold runtime metadata.html: internal error: indexOfElementInScope unknown scope: %d[proxy.Provider.closeHandle] Failed to close handle "%d": %s
bigmod: internal error: u and v are not in the expected statetype mismatch in decoder: want struct type %s; got non-structCan't have key %q in inlined map; conflicts with struct fieldexpect
```

---

## deploy_web_app
*Offset: 55684631*

```
Deploy a JavaScript web application to a deployment provider.collected metric named %q collides with previously collected histogram named %qcollected histogram named %q collides with previously collected metric named %qAlways set the `cwd` param when using run_command. Do not use `cd` in commands.Use apply_patch for file edits. Keep changes focused and follow existing style.- Section headers should only be used where they genuinely improve scanability.neither PlanModel nor RequestedModel specified. You must specify a valid model.###############################################################################metadata: FromOutgoingContext got an odd number of input pairs for metadata: %dno command available for Windows (neither "powershell" nor "command" specified)Get "([^"]+)":\s*Not following redirect to .+ because its not in AllowedDomains<%s path="%s" language="%s">
<old_str>%s</old_str>
<new_str>%s</new_str>
</%s>
inference server URL does not have valid codeium.com or windsurf.com domain: %sWindows system assumed buffer larger than it is, events have likely been missed[DELETE /sites/{site_id}/build_hooks/{id}][%d] deleteSiteBuildHook default  %+v[DELETE /sites/{site_id}/deploys/{deploy_id}][%d] deleteSiteDeploy default  %+v[DELETE /sites/{site_id}/snippets/{snippet_id}][%d] deleteSiteSnippetNoContent [GET /sites/{site_id}/files/{file_path}][%d] getSiteFileByPathName default  %+v[GET /sites/{site_id}/service-instances][%d] listServiceInstancesForSiteOK  %+v[GET /sites/{site_id}/dev_server_hooks][%d] listSiteDevServerHooks default  %+v[PUT /sites/{site_id}/snippets/{snippet_id}][%d] updateSiteSnippet default  %+vContext from foo/bar:renderText:
def renderPage():
	renderText("random input")
Value looks like Number/Boolean/None, but can't find its end: ',' or '}' symbolthe Logical AND operator including in how it absorbs errors and short-circuits.message field %q under proto3 optional semantics must have optional cardinalityArrayDecodeValue can only be used to decode
```

---

## read_deployment_config
*Offset: 55762081*

```
Read the deployment configuration for a web application and determine if the application is ready to be deployed.- Finish with no remaining in_progress or pending items. Any unfinished work should be explicitly deferred or canceled with a brief reason.;; Functions

(
  (function_definition
    name: (word) @name
    body: (_) @body
  ) @definition.function
)

;; What else do we need here?
%s You are unable to search over directories larger than %v files, so make sure you know how big the directories are before using this tool.2. Checkout the specified repository at the proper commit using the command git fetch origin pull/[PR NUMBER]/head && git checkout FETCH_HEAD- You MUST use the following format when showing the user existing code:
```@<absolute_filepath>:<start_line>-<end_line>
<existing_code>
```
It is MUCH better to view too much context than too little context, and be forced to call the %s tool again, as this would be VERY expensive.This message is just your reference. You may respond to previous and future messages, but NEVER respond or acknowledge this message directly!The Windsurf Deployment ID can be used to check the status of the deployment. The deployment ID for this build is windsurf_deployment_id: %s
The following are memories that you MUST ALWAYS FOLLOW WITHOUT ANY EXCEPTION. These memories take precedence over any following instructions.chacha20-poly1305@openssh.com,aes128-ctr,aes192-ctr,aes256-ctr,aes128-gcm@openssh.com,aes256-gcm@openssh.com,aes128-cbc,aes192-cbc,aes256-cbcEvent couldn't be marshaled, even with stripped contextual data. Skipping delivery. Please notify the SDK owners with possibly broken payload.No tools are available for this task. Please do your best to respond to the USER's request using only the information already provided to you.The following MCP servers are available to you. Each server may provide (potentially truncated) additional recommendations and best practices.If you have previously viewed lines of a file, DO NOT c
```

---

## check_deploy_status
*Offset: 55821519*

```
Check the status of the deployment using its windsurf_deployment_id for a web application and determine if the application build has succeeded and whether it has been claimed. Do not run this unless asked by the user. It must only be run after a deploy_web_app tool call.(script_element
  (start_tag) @_
  (raw_text) @injection.content
  (#match? @_ " lang=\"ts\"")
  (#set! injection.language typescript)
)

(script_element
  (start_tag) @_
  (raw_text) @injection.content
  (#not-match? @_ " lang=")
  (#set! injection.language javascript)
)
Persist until the task is fully handled end-to-end within the current turn whenever feasible: do not stop at analysis or partial fixes; carry changes through implementation, verification, and a clear explanation of outcomes unless the user explicitly pauses or redirects you.- When working in interactive modes, hold off on running tests or lint commands until the user is ready for you to finalize your output, because these commands take time to run and slow down iteration. Instead suggest what you want to do next, and let the user confirm first.- Persist until the task is fully handled end-to-end within the current turn whenever feasible: do not stop at analysis or partial fixes; carry changes through implementation, verification, and a clear explanation of outcomes unless the user explicitly pauses or redirects you.Your final message should read naturally, like an update from a concise teammate. For casual conversation, brainstorming tasks, or quick questions from the user, respond in a friendly, conversational tone. You should ask questions, suggest ideas, and adapt to the user's style.Analyze the codebase and understand the structure. Trace upwards and downwards, digging into implementations as well as callsites, to provide a comprehensive answer.
	Trace across service boundaries and abstractions to find the core pieces of logic that make up the full code path.# Copyright Exafunction
# Copyright Exafunction
# Copyright Exafunction
```

---

## todo_list / update_plan
*Offset: 55782616*

```
Updates the task plan. Provide an optional explanation and a list of plan items, each with a non-empty step description and status. At most one step can be in_progress at a time.Command timed out, needed to complete in %vs. This timeout applies to all commands. You won't be able to run this command with these arguments, do not retry exact the same commandVerification tools: Prefer available automated verification (e.g., Playwright, unit tests) to confirm work. Provide copy-pastable commands for the user when tools are unavailable.Could not successfully apply any edits. You clearly do not have a good grasp on the current contents of the file. Please review the file and make sure the target content is correct - You might be asked to create a new workflow. If so, create a new file in %s%s (use absolute path) following the format described above. Be very specific with your instructions.
When you update the plan, please pick smaller TargetContent within the ReplacementChunks. Do not use the entire file as the target content, otherwise this is extremely inefficient.Report bugs found in the code diff. Call this tool to submit your bug findings. Each bug should include the file path, line numbers, description, severity, and suggested resolution.You DO NOT need to be conservative about creating memories. Any memories you create will be presented to the USER, who can reject them if they are not aligned with their preferences.This concludes the chat conversation. Review the following PROPOSALS and select the most appropriate one using the %[1]s tool:
%s

DO NOT CALL ANY OTHER TOOLS BESIDES THE %[1]s TOOL.Identify clusters of functionality in the codebase that are most relevant to the search query. Useful for broadly idenitifying relevant areas of the codebase that can be honed in on.This tool looks up specific knowledge base items by ID, if relevant to the conversation at hand. ONLY call this tool if you see knowledge_base items referenced in your system prompt.To create a new
```

---

## create_memory
*Offset: 55688506*

```
Save important context relevant to the USER and their task to a memory database.- Never use unicode bullet points. Use the markdown list syntax to format lists.- Multiple grep searches with different regex patterns should run simultaneouslyBe terse and direct. Briefly summarize after clusters of tool calls when needed.If changes are in files you touched, understand them; if unrelated, ignore them.When user asks for 'review', prioritize bugs, risks, regressions, missing tests.- Receive user prompts and context from the IDE, such as files in the workspace.- If the changes are in unrelated files, just ignore them and don't revert them.(#eq? <@capture|"literal"> <@capture|"literal">)
Checks if two values are equal.ntlm> No credentials were provided. Assuming current user credentials from SSPI.crypto/ecdh: internal error: nistec ScalarBaseMult failed for a fixed-size input(0x[0-9A-Fa-f]([0-9A-Fa-f]|\.)*|\d(\d|\.)*)([uU][lL]{0,2}|([eE][-+]\d*)?[fFlL]*)xml: end tag </%s> in namespace %s does not match start tag <%s> in namespace %s[POST /sites/{site_id}/dev_server_hooks][%d] createSiteDevServerHookCreated  %+vno expected state found, authorization flow may not have been initiated properly[proxy.Provider.readWinHttpProxy] No proxy discovered via AutoConfigUrl, %s: %s
crypto/rand: blocked for 60 seconds waiting to read random data from the kernel
files cannot contain NULL bytes; probably using UTF-16; TOML files must be UTF-8xpath: string-join(node-sets, separator) function requires node-set and argument (bad use of unsafe.Pointer or having race conditions? try -d=checkptr or -race)
You've reached your hourly limit for codemap suggestions. Please try again later./exa.language_server_pb.LanguageServerService/StreamUserTrajectoryReactiveUpdates/exa.language_server_pb.LanguageServerService/GetCascadeTranscriptForTrajectoryId/exa.api_server_pb.ApiServerService/GetWindsurfJSAppDeploymentStatusesByProjectId
You should pick the URLs of text heavy documents you would like to read fu
```

---

## ask_user_question
*Offset: 55696759*

```
Ask the user a question with predefined options to choose from`Edit Codemap`: Edit an existing codemap with a prompt and optional starting pointsNumber of heap bytes released to OS. Equals to /memory/classes/heap/released:bytes.- Reading multiple files or searching different directories can be done all at once- Keep the voice collaborative and natural, like a coding partner handing off work.- User updates are short updates while you are working; they are NOT final answers.crypto/rsa: use of keys smaller than 2048 bits is not allowed in FIPS 140-only modecrypto/cipher: use of CBC with non-AES ciphers is not allowed in FIPS 140-only modecrypto/cipher: use of CTR with non-AES ciphers is not allowed in FIPS 140-only modecrypto/cipher: use of GCM with non-AES ciphers is not allowed in FIPS 140-only modecrypto/hmac: use of keys shorter than 112 bits is not allowed in FIPS 140-only mode//wiki.eclipse.org/index.php/Linux_Tools_Project/GDB_Tracepoint_Analysis/User_Guidemultiple replace_file_content tags not supported: encountered multiple special tags[GET /sites/{site_id}/traffic_splits/{split_test_id}][%d] getSplitTest default  %+vError converting ephemeral trajectory for cumulative prompt. Instruction length: %dMemory that is occupied by runtime mcache structures that are currently being used.timestamp('2023-07-14T10:30:45.123Z').getMilliseconds('America/Los_Angeles') // 123Port to connect to the extension server. If unset, the extension server is not used.tls: downgrade attempt detected, possibly due to a MitM attack or a broken middleboxx509: signature algorithm specifies an %s public key, but have public key of type %T^(?:(?P<user>[^@]+)@)?(?P<host>[^:\s]+):(?:(?P<port>[0-9]{1,5}):)?(?P<path>[^\\].*)$[ConvergeArenaCascades] cascadeId=%s (this is a NON-TARGET cascade being converged)
user reviewed the command and decided not to run it, check with the user to continueYou have access to a %v tool, which you can use to broadcast a message to the USER. - Code style: Do not a
```

---

## search_web
*Offset: 55735733*

```
Performs a web search to get a list of relevant web documents for the given query and optional domain filter.Total number of bytes allocated in heap until now, even if released already. Equals to /gc/heap/allocs:bytes.Origin, Access-Control-Request-Method, Access-Control-Request-Headers, Access-Control-Request-Private-NetworkYou are Cascade, a coding agent running in the user's IDE. You are expected to be precise, safe, and helpful.invalid nil message info; this suggests memory corruption due to a race or shallow copy on the message struct(?m)^\s*(@(interface|class|protocol|property|end|synchronised|selector|implementation)\b|#import\s+.+\.h[">])Prev tool name %q and current name %q don't match. Prev name should be empty if it's not a complete name yet.Memory occupied by live objects and dead objects that have not yet been marked free by the garbage collector.DeepWiki is disabled for this gitignored file. Enable 'Gitignore Access' in Windsurf Settings to allow access.Invalid project name: Project names must only contain letters, numbers, and hyphens (not at the start or end).Grep v2 command timed out due to the size of the codebase. Use a more targeted grep search to avoid a timeout.Resource available (use the read_resource tool to fetch it):
  uri: %s
  name: %s
  mime: %s
  description: %s%s does not have same minor version as %s. Expected minor versions to match when constraint major version is 0(?m)^\s*module\s+type\s|^\s*(?:include|open)\s+\w+\s*;\s*$|^\s*let\s+(?:module\s\w+\s*=\s*{|\w+:\s+.*=.*;\s*$)VT_EMPTYVT_NULLVT_I2VT_I4VT_R4VT_R8VT_CYVT_DATEVT_BSTRVT_DISPATCHVT_ERRORVT_BOOLVT_VARIANTVT_UNKNOWNVT_DECIMALinternal/sync.HashTrieMap: ran out of hash bits while inserting (incorrect use of unsafe or cgo, or data race?)too many files selected (%d files). Please filter down your search to %d files or fewer to use Vibe and Replace
Note: %d lines were truncated because they were too long to show here. The command finished with exit code %d.- Each line in the patch
```

---

## read_url_content
*Offset: 55655541*

```
Read content from a URL accessible via a web browserRefer to the USER in the second person and yourself in the first person.If you notice unexpected changes you didn't make, STOP and ask the user.Don't use apply_patch for auto-generated changes or mass search-replace.Ask before destructive actions, elevated permissions, or network access.- Don't cram unrelated keywords into a single bullet; split for clarity.connect> Proxy successfully established. No authentication was required.crypto/rsa: use of multi-prime keys is not allowed in FIPS 140-only modecrypto/fips140: FIPS 140-3 mode enabled, but integrity check didn't pass//**********************************************************************persons.ProtocolBuffer.internal_static_persons_Person_fieldAccessorTable////////////////////////////////////////////////////////////////////////<helmut.wollmersdorfer@gmail.com|mailto:helmut.wollmersdorfer@gmail.com>errgroup: modify limit while %v goroutines in the group are still active[POST /dns_zones/{zone_id}/dns_records][%d] createDnsRecord default  %+v[POST /deploys/{deploy_id}/plugin_runs][%d] createPluginRun default  %+v[POST /sites/{site_id}/build_hooks][%d] createSiteBuildHook default  %+v[POST /sites/{site_id}/dev_servers][%d] createSiteDevServer default  %+v[GET /{account_id}/builds/status][%d] getAccountBuildStatus default  %+v[GET /sites/{site_id}/plugin_runs/latest][%d] getLatestPluginRunsOK  %+v[POST /sites/{site_id}/ssl][%d] provisionSiteTLSCertificate default  %+v[PATCH /accounts/{account_id}/env/{key}][%d] setEnvVarValue default  %+v[GET /services/{addonName}/manifest][%d] showServiceManifestCreated  %+v[PUT /{account_slug}/members/{member_id}][%d] updateAccountMemberOK  %+vdecoding float32 array or slice: length exceeds input size (%d elements)decoding float64 array or slice: length exceeds input size (%d elements)decoding uintptr array or slice: length exceeds input size (%d elements) can only be decoded from remote interface type; received concrete type json
```

---

## view_content_chunk
*Offset: 55803965*

```
View a specific chunk of a web or knowledge base document content using its DocumentId and chunk position. The DocumentId must have already been read by the %s tool before this can be used on that particular DocumentId.This concludes the chat conversation. Review the following MEMORIES and select those that should be shown to the other AI coding assistant using the %[1]s tool:
%s\n
DO NOT CALL ANY OTHER TOOLS BESIDES THE %[1]s TOOL.
		Maintain statuses in the tool: exactly one item in_progress at a time; mark items complete when done; post timely status transitions. Finish with all items completed or explicitly canceled/deferred before ending the turn.The following is a list of conditional rules in the format [ID]: [RULE]. Only follow these rules if you are explicitly prompted to look at a rule by ID, and only follow the rules that you are explicitly prompted to follow.Please update the plan if it needs updating at: `%s`. Use the `%s` tool only if you need to update the plan, you currently have no other tools. Please do not state the plan contents in your response, only in the tool call.Incorrect argument format for tool. The value for %s.%s should be a JSON array, not a string-escaped JSON array. While attempting to recover by unmarshaling the string-escaped JSON array, another error was encountered (%v)When you update the plan, your tool call should be extremely targeted. Only include the parts that need to be changed in your CodeEdit. Do not include the entire file in the CodeEdit, otherwise this is extremely inefficient.# Code Interaction Summary:
The following is an important list of code items that you have previously edited and viewed. Study this information carefully and only re-view code items if it is absolutely required to proceed. %sTask List: should be a markdown checklist of the steps in the plan. This should contain historical steps that have been completed in addition to a number of planned future steps. You may prune out very old or irrelevant steps
```

---

## trajectory_search
*Offset: 55809620*

```
Semantic search or retrieve trajectory. Trajectories are one of %s. Returns chunks from the trajectory, scored, sorted, and filtered by relevance. Maximum number of chunks returned is %d. Call this tool when the user @mentions %s. %sApproximate total count of cleanup functions (created by runtime.AddCleanup) executed by the runtime. Subtract /gc/cleanups/queued:cleanups to approximate cleanup queue length. Useful for detecting slow cleanups holding up the queue.If there's something that you think you could help with as a logical next step, concisely ask the user if they want you to do so. Good examples of this are running tests, committing changes, or building out the next logical component.(?m)^\s*\w+\s*(?:,\s*\w+)*[:]\s*\w+\s|^\s*\w+\s*(?:\(\s*\w+[:][^)]+\))?(?:[:]\s*\w+)?(?:--.+\s+)*\s+(?:do|local)\s|^\s*(?:across|deferred|elseif|ensure|feature|from|inherit|inspect|invariant|note|once|require|undefine|variant|when)\s*$**IMPORTANT: this summary is just for your reference. You may respond to my previous and future messages, but DO NOT ACKNOWLEDGE THIS CHECKPOINT MESSAGE. JUST READ IT BUT DO NOT MENTION IT, RESPOND TO IT, OR TAKE ACTION BECAUSE OF IT.**- Direct responses: Always provide an initial commentary message immediately to acknowledge the request and explain your approach. Do not use thinking tokens or preambles before this initial commentary - communicate with the user right away.*************************************************************************************************************************************************************************************************************************************************The previous CodeEdit was suggested by %v to: %v. The diff was not immediately applied to the file due to the changes being flagged as potentially incomplete or incorrect. The user will manually review the changes and may decide to apply them.These memories were automatically retrieved from previous conversations and may or may not be relevant t
```

---

## read_notebook
*Offset: 55533992*

```
Read and parse a Jupyter notebook fileVibe and replace generation using model %s and %d toolsStack traces that led to the creation of new OS threadsTotal number of stream messages received by server-sideTotal number of stream messages received by client-sidehistogram buckets must be in increasing order: %f >= %fWindsurf Preview encountered an HTML rendering failure.Skip planning for straightforward tasks (easiest ~25%).- Do not use URIs like file://, vscode://, or https://.Skipping commit %s because it has too many changes (%d)number of target files (%d) exceeds MaxTargetFiles (%d)No completion mode to migrate (proto field unspecified)CascadePerformanceTracker: Cleaning up stale session %sconnect> No proxy authentication completed successfullynegotiate> Could not read token response from proxy: %sntlm> Could not write authenticate message to proxy: %smap merge requires map or sequence of maps as the valuealias value must contain alphanumerical characters onlyecdsa: internal error: shift can only be by 1 to 7 bitscipher.NewCBCEncrypter: IV length must equal block sizecipher.NewCBCDecrypter: IV length must equal block sizeeach colon-separated field must have at least one digitFloat.GobDecode: buffer too small for finite form floatextension number %d is already registered on message %vinvalid GORISCV64: must be rva20u64, rva22u64, rva23u64progressive AC coefficients for more than one componentcom.google.protobuf.GeneratedMessage.FieldAccessorTable<i;k++)g(a[k],c,f?d.call(a[k],k,g(a[k],c)):d,h);return><i;o++)e(a[o],b,f?d.call(a[o],o,e(a[o],b)):d,j);return>DbXGGoVJIgeqBVexEVKxxspaQogztrgMtdHTF/FjGUYbbZIrgocQoqDcom.facebook.proguard.annotations.KeepGettersAndSetters#DAVE##################################################cannot add a child (id = %d) of type %T to a subChannelclosing transport due to: %v, received prior goaway: %va HEADERS frame cannot appear in the middle of a streamcould not find common prefix from previous conversation[%s] Subagent executor finished. Exec
```

---

## edit_notebook
*Offset: 55892525*

```
Completely replaces the contents of a specific cell in a Jupyter notebook (.ipynb file) with new source. Jupyter notebooks are interactive documents that combine code, text, and visualizations, commonly used for data analysis and scientific computing. The notebook_path parameter must be an absolute path, not a relative path. The cell_number is 0-indexed. Use edit_mode=insert to add a new cell at the index specified by cell_number. When inserting into an empty notebook (0 cells), cell_number must be 0. Note: Cascade cannot delete notebook cells. If a cell should be deleted, ask the user to delete it manually. You can edit the cell content to indicate it should be deleted (e.g., add a comment like '# TODO: Delete this cell').
```

---

## list_dir
*Offset: 55844919*

```
Lists files and directories in a given path. The path parameter must be an absolute path to a directory that exists. For each item in the directory, output will have: relative path to the file or directory, and size in bytes if file or number of items (recursive) if directory. You should generally prefer the %s and %s tools, if you know which directories to search.Use this tool to create new files. The file and any parent directories will be created for you if they do not already exist.
		Follow these instructions:
		1. NEVER use this tool to modify or overwrite existing files. Always first confirm that TargetFile does not exist before calling this tool.
		2. You MUST specify the full TargetFile before any of the code contents.Estimated total CPU time spent performing GC tasks on spare CPU resources that the Go scheduler could not otherwise find a use for. This should be subtracted from the total GC CPU time to obtain a measure of compulsory GC CPU time. This metric is an overestimate, and not directly comparable to system CPU time measurements. Compare only with other /cpu/classes metrics.Translate the following code into %[1]s obeying the following instructions:
- Keep the code as close to the original as possible
- Make the code functional in %[1]s
- The output should be in %[1]s with as few changes as possible
- Keep all non-code comments and docstrings as close to the original as possible
Here is an example of translating from python to typescript:
Reflect and update the plan that needs to be followed to accomplish the task at hand. This should be called whenever new information is received, either from the user, or from performing research, that changes the course of action that should be taken. Take into account the update reason when updating the plan. You should NEVER call this tool multiple times in parallel.Ask the user a question with predefined options. Use this when you need the user to make a choice between specific options.
You can provide up to 4 op
```

---

## list_resources (MCP)
*Offset: 55813485*

```
Lists the available resources from an MCP server. Note that tools are not resources. Resources are static data that an MCP server provides. Not all MCP servers provide resources and so some will give errors even if the MCP server functions correctly.
```

---

## read_resource (MCP)
*Offset: 55399835*

```
Retrieves a specified resource's contents.skill '%s' not found. Available skills: %v%q is not a valid label name for metric %qNumber of goroutines that currently exist.called Float64 on non-float64 metric valueencountered MetricFamily with invalid typecollected metric %s %s should be a Countercollected metric %s %s should be a Summaryexemplar label value %q is not valid UTF-8promhttp_metric_handler_requests_in_flightWindsurf Preview encountered a fatal errorfailed to save metadata for brain entry %sUpdate plan after completing each subtask.Failed to marshal workflow frontmatter: %vFailed to cleanup deprecated workflows: %vFailed to rename worktree branch to %s: %vfailed to remove code tracker commit stateSplit and batched CCI with subranges in %smigration_allowCascadeAccessGitignoreFilesMigrating lastSelectedCascadeModelUids: %vDecodeTokens error - code: %d, message: %vinvalid array: want %d elements but got %dcrypto/rsa: salt length cannot be negativepoly1305: write to MAC after Sum or Verifyinsufficient data for resource body lengthquotedprintable: invalid bytes after =: %qaddition of infinities with opposite signssubtraction of infinities with equal signsPrintableString contains invalid characterfile size (%d) does not match src len (%d) Rectangle has huge or negative dimensionsNo support for lazy fns for ExtensionField(?m)^\s*(import|module|package|data|type) (?m)OUTPUT_ARCH\(|OUTPUT_FORMAT\(|SECTIONS(^|/)materialize\.(css|less|scss|styl|js)$(^|/)tiny_mce/(langs|plugins|themes|utils)(^|/)jquery([^.]*)\.unobtrusive\-ajax\.js$//________________________________________//api.github.com/repos/Microsoft/AL/issuesMissingTwilioConfigCustomSettingsExceptionOfflineAudioCompletionEvent/renderedBufferWGL_BIND_TO_TEXTURE_RECTANGLE_FLOAT_RGB_NV<google/protobuf/generated_message_util.h>CHECK_STDCALL_FUNCTION_EXISTS_ADD_INCLUDESred_spec_call_array_new_single_set_length.red_spec_function_has_instance_after_bind_red_spec_object_define_own_prop_args_obj_1red_spec_object_define_own
```

---

## propose_code
*Offset: 55542597*

```
Propose Code`: Propose code changes to an existing file`Bash`: Execute a shell command with specified argumentsinvalid value for "seconds" - must be a positive integerNumber of seconds since 1970 of last garbage collection.exemplar labels have %d runes, exceeding the limit of %dInvalid cciIdx in %d ccis in the request for item %v: %vNo smart friend model UID to migrate (proto field empty)[Onboarding] Failed to marshal onboarding state to JSON:file URLs must leave host empty or use localhost: got %vsocks> Could not call dial socks4 context with proxy: %sattempted to go past the end of stream; corrupted value?anchor value must contain alphanumerical characters onlyoption ,inline may only be used on a struct or map fieldecdsa: curve not supported by ParseUncompressedPublicKeyb4050a850c04b3abf54132565044b0b7d7bfd8ba270b39432355ffb4b70e0cbd6bb4bf7f321390b94a03c1d356c21122343280d6115c1d21bd376388b5f723fb4c22dfe6cd4375a05a07476444d5819985007e34crypto/cipher: internal error: generic CBC used with AEScrypto/cipher: internal error: generic CTR used with AEShttps://protobuf.dev/reference/go/faq#namespace-conflictPRIORITY_UPDATE frame with prioritized stream ID of zerox448: zero keys only, randomness source might be corruptinvalid value: setting repeated field to read-only value(?m)^\s*\.(?:include\s|globa?l\s|[A-Za-z][_A-Za-z0-9]*:)(?m)^[\s&&[^\n]]*=(comment|begin pod|begin para|item\d+)\s+(name|content|value)\s*=\s*("[^"]+"|'[^']+'|[^\s"']+)//______________________________________________________red_spec_env_record_get_binding_value_1_decl_initializedred_spec_object_define_own_prop_array_3l_condition_falseinvoker.secondary_abi_shared_libraries_runtime_deps_file********************************************************@com.facebook.proguard.annotations.KeepGettersAndSettersysrURWYpFIJBKLRJJTVZsUQcKKTajZEAQhCBIqmrSCpAiSIhCfQFQgKkGenerated by the protocol buffer compiler.  DO NOT EDIT!pickfirst: received illegal BalancerConfig (type %T): %vAborting the stream early due to InTapHan
```

---

## bash
*Offset: 55542653*

```
Bash`: Execute a shell command with specified argumentsinvalid value for "seconds" - must be a positive integerNumber of seconds since 1970 of last garbage collection.exemplar labels have %d runes, exceeding the limit of %dInvalid cciIdx in %d ccis in the request for item %v: %vNo smart friend model UID to migrate (proto field empty)[Onboarding] Failed to marshal onboarding state to JSON:file URLs must leave host empty or use localhost: got %vsocks> Could not call dial socks4 context with proxy: %sattempted to go past the end of stream; corrupted value?anchor value must contain alphanumerical characters onlyoption ,inline may only be used on a struct or map fieldecdsa: curve not supported by ParseUncompressedPublicKeyb4050a850c04b3abf54132565044b0b7d7bfd8ba270b39432355ffb4b70e0cbd6bb4bf7f321390b94a03c1d356c21122343280d6115c1d21bd376388b5f723fb4c22dfe6cd4375a05a07476444d5819985007e34crypto/cipher: internal error: generic CBC used with AEScrypto/cipher: internal error: generic CTR used with AEShttps://protobuf.dev/reference/go/faq#namespace-conflictPRIORITY_UPDATE frame with prioritized stream ID of zerox448: zero keys only, randomness source might be corruptinvalid value: setting repeated field to read-only value(?m)^\s*\.(?:include\s|globa?l\s|[A-Za-z][_A-Za-z0-9]*:)(?m)^[\s&&[^\n]]*=(comment|begin pod|begin para|item\d+)\s+(name|content|value)\s*=\s*("[^"]+"|'[^']+'|[^\s"']+)//______________________________________________________red_spec_env_record_get_binding_value_1_decl_initializedred_spec_object_define_own_prop_array_3l_condition_falseinvoker.secondary_abi_shared_libraries_runtime_deps_file********************************************************@com.facebook.proguard.annotations.KeepGettersAndSettersysrURWYpFIJBKLRJJTVZsUQcKKTajZEAQhCBIqmrSCpAiSIhCfQFQgKkGenerated by the protocol buffer compiler.  DO NOT EDIT!pickfirst: received illegal BalancerConfig (type %T): %vAborting the stream early due to InTapHandle failure: %vempty string is not a valid method binary
```

---

## apply_patch
*Offset: 55498764*

```
Apply a freeform patch to edit filesUse this when a task matches a skill's description.Generating vibe and replace content for file %s: %sTotal number of stream messages sent by server-sideTotal number of stream messages sent by client-sidehtml: AppendChild called for an attached child NodeInvalid trigger type. Use one of: %s, %s, %s, or %sfailed to remove empty code tracker state directoryactive doc for refresh does not match current stateAfter splitting to max size %d, rerankIdx is now %dMigrating cascadePlannerMode: proto=%v -> native=%qCascadePerformanceTracker: no active span for %s %sCascadePerformanceTracker: API server client is nilquery parameters not allowed with file URLs: got %vconnect> Could not call dial context with proxy: %sconnect> Skipping Negotiate due to AuthSchemeFilterline %d: mapping key %#v already defined at line %d%s does not have same major and minor version as %scrypto/elliptic: Add was called on an invalid pointx448: the ephemeral public key is a low order pointinsufficient selector indices for number of symbolsinvalid AppendMutable on list with non-message typeinvalid value: setting map field to read-only valueextension %v extends %v outside the extension rangefield %v has invalid type: got %v, want struct kindfield %v has invalid type: %v does not implement %vred_spec_object_define_own_prop_array_3l_iii_2_trueruns_type_correct_object_define_own_prop_array_loopnokogiri.internals.NokogiriHelpers.getNokogiriClassorg.apache.xerces.xni.parser.XMLParserConfiguration//wiki.amigaos.net/wiki/ILBM_IFF_Interleaved_BitmapAlOeONMCGwMHCwkIBwMCAQYVCAIJCgsEFgIDAQIeAQIXgAAKCRCCOUNT_IMGS_let_movies_starfile_let_movies_tablenamecannot add a child (id = %d) of type %T to a serverreceived %d-bytes data exceeding the limit %d bytesstream terminated by RST_STREAM with error code: %vkeepalive ping failed to receive ACK within timeout[HOOKS] Failed to parse cloud team config hooks: %v[HOOKS] Loaded %d hooks from workspace location: %sQwencoder benign error, un
```

---

## skill
*Offset: 55632234*

```
Invoke a skill to get detailed instructions or knowledge for a task.labels in collected metric %s %s are inconsistent with descriptor %scontent compression format not recognized: %s. Valid formats are: %s- If making very large edits (>300 lines), break into smaller edits.- There are logical phases or dependencies where sequencing matters.- Be concise and factual
```

---

## report_bugs
*Offset: 55783692*

```
Report bugs found in the code diff. Call this tool to submit your bug findings. Each bug should include the file path, line numbers, description, severity, and suggested resolution.You DO NOT need to be conservative about creating memories. Any memories you create will be presented to the USER, who can reject them if they are not aligned with their preferences.This concludes the chat conversation. Review the following PROPOSALS and select the most appropriate one using the %[1]s tool:
%s

DO NOT CALL ANY OTHER TOOLS BESIDES THE %[1]s TOOL.Identify clusters of functionality in the codebase that are most relevant to the search query. Useful for broadly idenitifying relevant areas of the codebase that can be honed in on.This tool looks up specific knowledge base items by ID, if relevant to the conversation at hand. ONLY call this tool if you see knowledge_base items referenced in your system prompt.To create a new plan, call `update_plan` with a short list of 1-sentence steps (no more than 5-7 words each) with a `status` for each step (`pending`, `in_progress`, or `completed`).Prefer minimal, focused edits using the %s or %s tools. Keep changes scoped, follow existing style, and write general-purpose solutions. Avoid helper scripts or hard-coded shortcuts.   - For example if a workflow includes:
```
2. Make a folder called foo
// turbo
3. Make a folder called bar
```
You should auto-run step 3, but use your usual judgement for step 2.
/**
 * A description of the entire PHP function.
 *
 * @param datatype $paramname description
 * @throws Some_Exception_Class description of exception
 * @return Some_Return_Value
 */- Some tools run asynchronously, so you may not see their output immediately. If you need to see the output of previous tool calls before continuing, simply stop making new tool calls.2. If an external API requires an API Key, be sure to point this out to the USER. Adhere to best security practices (e.g. DO NOT hardcode an API key in a place where it can be e
```

---

## restricted_exec (subagent)
*Offset: 56206978*

```
{"type": "function", "function": {"name": "restricted_exec", "description": "Execute restricted commands (rg, readfile, tree, ls, glob) in parallel.", "parameters": {"type": "object", "properties": {"command1": {"type": "object", "description": "Command 1 to execute. Must be one of: rg, readfile, or tree.", "oneOf": [{"properties": {"type": {"type": "string", "const": "rg", "description": "Search for patterns in files using ripgrep."}, "pattern": {"type": "string", "description": "The regex pattern to search for."}, "path": {"type": "string", "description": "The path to search in (file or directory)."}, "include": {"type": "array", "items": {"type": "string"}, "description": "File patterns to include in the search."}, "exclude": {"type": "array", "items": {"type": "string"}, "description": "File patterns to exclude from the search."}}, "required": ["type", "pattern", "path"]}, {"properties": {"type": {"type": "string", "const": "readfile", "description": "Read contents of a file with optional line range."}, "file": {"type": "string", "description": "Path to the file to read."}, "start_line": {"type": "integer", "description": "Starting line number (1-indexed)."}, "end_line": {"type": "integer", "description": "Ending line number (1-indexed)."}}, "required": ["type", "file"]}, {"properties": {"type": {"type": "string", "const": "tree", "description": "Display directory structure as a tree."}, "path": {"type": "string", "description": "Path to the directory to display."}, "levels": {"type": "integer", "description": "Number of directory levels to show."}}, "required": ["type", "path"]}, {"properties": {"type": {"type": "string", "const": "ls", "description": "List files in a directory."}, "path": {"type": "string", "description": "Path to the directory to list."}, "long_format": {"type": "boolean", "description": "Use long format."}, "all": {"type": "boolean", "description": "Show all files, including hidden files."}}, "required": ["type", "path"]}, {"properties": {"t
```

---

## cluster_query
*Offset: 55784237*

```
Identify clusters of functionality in the codebase that are most relevant to the search query. Useful for broadly idenitifying relevant areas of the codebase that can be honed in on.This tool looks up specific knowledge base items by ID, if relevant to the conversation at hand. ONLY call this tool if you see knowledge_base items referenced in your system prompt.To create a new plan, call `update_plan` with a short list of 1-sentence steps (no more than 5-7 words each) with a `status` for each step (`pending`, `in_progress`, or `completed`).Prefer minimal, focused edits using the %s or %s tools. Keep changes scoped, follow existing style, and write general-purpose solutions. Avoid helper scripts or hard-coded shortcuts.   - For example if a workflow includes:
```
2. Make a folder called foo
// turbo
3. Make a folder called bar
```
You should auto-run step 3, but use your usual judgement for step 2.
/**
 * A description of the entire PHP function.
 *
 * @param datatype $paramname description
 * @throws Some_Exception_Class description of exception
 * @return Some_Return_Value
 */- Some tools run asynchronously, so you may not see their output immediately. If you need to see the output of previous tool calls before continuing, simply stop making new tool calls.2. If an external API requires an API Key, be sure to point this out to the USER. Adhere to best security practices (e.g. DO NOT hardcode an API key in a place where it can be exposed)The following is an outline of the file the user is currently editing, where all of the functions and classes are summarized with approximate line ranges, and other lines are abridged.
Approximate count of goroutines executing. Always less than or equal to /sched/gomaxprocs:threads. Not guaranteed to add up to /sched/goroutines:goroutines with other goroutine metrics.The TODO list has not been updated after the %d most recent user message(s), you should call the %s tool to update it if there have been changes to the state of complet
```

---

## code_search_v2
*Offset: 55777776*

```
Returns code snippets in the specified file that are most relevant to the search query. Shows entire code for top items, but only a docstring and signature for others.Approximate count of goroutines running or blocked in a system call or cgo call. Not guaranteed to add up to /sched/goroutines:goroutines with other goroutine metrics.- Identify likely call sites or consumers that must be updated if you change a central abstraction, and note any open questions to resolve before making invasive edits.You may have seen the following lint errors as feedback for a previous edit, but they still exist at this point. Please respond accordingly, erring toward explicitness.(#lineage-from-name! "literal")
If the name captures scopes, split by "literal" and retain the last element as the name. The other elements are appended to the lineage.-- THIS IS A SERIALIZED HUMAN-READABLE VERSION OF A CONVERSATION BETWEEN A USER AND ANOTHER AI MODEL. YOU SHOULD STILL CALL TOOLS AS DESCRIBED IN YOUR SYSTEM PROMPT. -- - Valid (multi-line): 
```@/Users/alice/projects/myapp/src/utils/file.py:1-3
print("existing code line 1")
print("existing code line 2")
print("existing code line 3")
```
(type_declaration
    (type_spec
        type: (struct_type
            (field_declaration_list
                (field_declaration) @field
            )
        )
    )
)
- If a tool exists for an action, prefer to use the tool instead of shell commands (e.g `view_file` over `cat`). Strictly avoid `run_command` when a dedicated tool exists.^v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(-(0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(\.(0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(\+[0-9a-zA-Z-]+(\.[0-9a-zA-Z-]+)*)?$The USER will give you a pull request link, a guideline that they would like to follow, and a list of files and line numbers (inclusive) that they would like you to review.The following is the current list of user-defined conditional rules, along with a description on when to use them. They are provided in -
```

---

