# Cascade Tool Use - Complete Reverse Engineering

## Overview

Cascade (Windsurf's AI agent) uses a **trajectory-based** execution model. Each AI action is a `CortexTrajectoryStep` with a `oneof step` field that determines the tool being invoked.

The full list of 37 tool types is extracted from `exa/cortex_pb/cortex.proto`:

## CortexTrajectoryStep - Complete Tool Registry

```protobuf
message CortexTrajectoryStep {
  oneof step {
    CortexStepDummy dummy = 7;
    CortexStepFinish finish = 12;
    CortexStepPlanInput plan_input = 8;
    CortexStepMquery mquery = 9;
    CortexStepCodeAction code_action = 10;
    CortexStepGitCommit git_commit = 11;
    CortexStepGrepSearch grep_search = 13;
    CortexStepViewFile view_file = 14;
    CortexStepListDirectory list_directory = 15;
    CortexStepCompile compile = 16;
    CortexStepInformPlanner inform_planner = 17;
    CortexStepUserInput user_input = 19;
    CortexStepPlannerResponse planner_response = 20;
    CortexStepFileBreakdown file_breakdown = 21;
    CortexStepViewCodeItem view_code_item = 22;
    CortexStepWriteToFile write_to_file = 23;
    CortexStepErrorMessage error_message = 24;
    CortexStepClusterQuery cluster_query = 25;
    CortexStepListClusters list_clusters = 26;
    CortexStepInspectCluster inspect_cluster = 27;
    CortexStepRunCommand run_command = 28;
    CortexStepRelatedFiles related_files = 29;
    CortexStepCheckpoint checkpoint = 30;
    CortexStepProposeCode propose_code = 32;
    CortexStepFind find = 34;
    CortexStepSearchKnowledgeBase search_knowledge_base = 35;
    CortexStepSuggestedResponses suggested_responses = 36;
    CortexStepCommandStatus command_status = 37;
    CortexStepMemory memory = 38;
    CortexStepLookupKnowledgeBase lookup_knowledge_base = 39;
    CortexStepReadUrlContent read_url_content = 40;
    CortexStepViewContentChunk view_content_chunk = 41;
    CortexStepSearchWeb search_web = 42;
    CortexStepRetrieveMemory retrieve_memory = 43;
    CortexStepAutoCascadeBroadcast auto_cascade_broadcast = 44;
    CortexStepCustomTool custom_tool = 45;
    CortexStepCreateRecipe create_recipe = 46;
    CortexStepMcpTool mcp_tool = 47;
    CortexStepManagerFeedback manager_feedback = 48;
  }
}
```

## Key Tool Definitions

### RunCommand (field 28)

```protobuf
message CortexStepRunCommand {
  string command_line = 23;         // The actual command to execute
  string proposed_command_line = 25; // What the AI proposes (before user approval)
  string cwd = 2;                   // Working directory
  bool blocking = 11;               // Wait for completion
  uint64 wait_ms_before_async = 12; // Async timeout
  bool should_auto_run = 15;        // Safe to auto-run?
  string requested_terminal_id = 17;
  string agent_harness = 26;
  string command_id = 13;           // Unique command ID
  optional int32 exit_code = 6;     // Result exit code
  bool user_rejected = 14;          // User rejected the command
  AutoRunDecision auto_run_decision = 16;
  string terminal_id = 18;
  RunCommandOutput combined_output = 21; // Captured output
  bool used_ide_terminal = 22;
  string raw_debug_output = 24;
  string shell_integration_failure_reason = 27;
  string shell_name = 28;
  repeated SimpleCommand parsed_commands = 29;
  string command = 1;               // Legacy field
}
```

### CodeAction / Edit (field 10)

```protobuf
message CortexStepCodeAction {
  ActionSpec action_spec = 1;       // What to do (file, edits)
  ActionResult action_result = 2;   // Result of the action
  bool use_fast_apply = 4;          // Use fast-apply vs full diff
  AcknowledgementType acknowledgement_type = 5;
  bool blocking = 6;
  CodeHeuristicFailure heuristic_failure = 7;
  string code_instruction = 8;      // Natural language instruction
  string markdown_language = 9;
  bool dry_run = 10;
  repeated CodeDiagnostic lint_errors = 11;
  repeated CodeDiagnostic persistent_lint_errors = 12;
  repeated ReplacementChunkInfo replacement_infos = 13;
  repeated string lint_error_ids_aiming_to_fix = 14;
  FastApplyFallbackInfo fast_apply_fallback_info = 15;
  bool target_file_has_carriage_returns = 16;
  bool target_file_has_all_carriage_returns = 17;
  repeated CortexStepCompileDiagnostic introduced_errors = 18;
  string triggered_memories = 19;
  BrainEntryDelta brain_delta = 20;
}
```

### WriteToFile (field 23)

```protobuf
message CortexStepWriteToFile {
  string target_file_uri = 1;
  repeated string code_content = 2;
  DiffBlock diff = 3;
  bool file_created = 4;
  AcknowledgementType acknowledgement_type = 5;
}
```

### ViewFile (field 14)

```protobuf
message CortexStepViewFile {
  string file_uri = 1;
  uint32 start_line = 2;
  uint32 end_line = 3;
  // Result populated after execution:
  repeated string content_lines = 4;
  uint32 total_lines = 5;
}
```

### GrepSearch (field 13)

```protobuf
message CortexStepGrepSearch {
  string query = 1;
  string directory = 2;
  bool case_sensitive = 3;
  bool regex = 4;
  repeated string include_patterns = 5;
  // Results:
  repeated GrepResult results = 6;
  uint32 total_matches = 7;
}
```

### SearchWeb (field 42)

```protobuf
message CortexStepSearchWeb {
  string query = 1;
  string domain = 2;
  // Results populated after execution
}
```

### ReadUrlContent (field 40)

```protobuf
message CortexStepReadUrlContent {
  string url = 1;
  // Results populated after execution
}
```

### McpTool (field 47)

```protobuf
message CortexStepMcpTool {
  string server_name = 1;
  string tool_name = 2;
  string arguments_json = 3;
  // Results populated after execution
}
```

### Memory (field 38)

```protobuf
message CortexStepMemory {
  string action = 1;   // create, update, delete
  string content = 2;
  string id = 3;
}
```

## Cascade Lifecycle

1. **StartCascade** → Returns `cascade_id`
2. **SendUserCascadeMessage** → Sends user input items + config
3. **StreamCascadeReactiveUpdates** → Server-streaming trajectory updates
4. **CancelCascadeInvocation** → Abort running cascade
5. **BranchCascade** → Fork from a step in existing cascade
6. **GetCascadeTrajectory** → Poll for full trajectory state
7. **ResumeCascade** → Resume after user provides input

## CascadeConfig

```protobuf
message CascadeConfig {
  string model_uid = 1;
  bool auto_apply = 2;
  bool auto_run_commands = 3;
  repeated string enabled_tools = 4;
  // ...
}
```

## AcknowledgementType

Determines how a tool action is presented to the user:

```protobuf
enum AcknowledgementType {
  ACKNOWLEDGEMENT_TYPE_UNSPECIFIED = 0;
  ACKNOWLEDGEMENT_TYPE_AUTO = 1;      // Auto-accepted
  ACKNOWLEDGEMENT_TYPE_PENDING = 2;    // Waiting for user approval
  ACKNOWLEDGEMENT_TYPE_ACCEPTED = 3;   // User accepted
  ACKNOWLEDGEMENT_TYPE_REJECTED = 4;   // User rejected
}
```

## CascadeRunStatus

```protobuf
enum CascadeRunStatus {
  CASCADE_RUN_STATUS_UNSPECIFIED = 0;
  CASCADE_RUN_STATUS_RUNNING = 1;
  CASCADE_RUN_STATUS_FINISHED = 2;
  CASCADE_RUN_STATUS_CANCELLED = 3;
  CASCADE_RUN_STATUS_ERROR = 4;
  CASCADE_RUN_STATUS_WAITING_FOR_USER = 5;
  CASCADE_RUN_STATUS_PAUSED = 6;
}
```
