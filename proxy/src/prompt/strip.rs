/// Windsurf native system prompt fragments to strip.
/// Extracted from Go binary reverse engineering (Phase 13).
const WINDSURF_PROMPT_FRAGMENTS: &[&str] = &[
    "You are Cascade, a powerful agentic AI coding assistant",
    "You are Cascade, Codeium's powerful agentic AI coding assistant",
    "<communication_style>",
    "</communication_style>",
    "<communication_guidelines>",
    "</communication_guidelines>",
    "<markdown_formatting>",
    "</markdown_formatting>",
    "<citation_guidelines>",
    "</citation_guidelines>",
    "<tool_calling>",
    "</tool_calling>",
    "<making_code_changes>",
    "</making_code_changes>",
    "<running_commands>",
    "</running_commands>",
    "<debugging>",
    "</debugging>",
    "<calling_external_apis>",
    "</calling_external_apis>",
    "<workflows>",
    "</workflows>",
    "<user_rules>",
    "</user_rules>",
    "<user_information>",
    "</user_information>",
    "<memory_system>",
    "</memory_system>",
    "<ide_metadata>",
    "</ide_metadata>",
    "<task_management>",
    "</task_management>",
    "The USER is interacting with you through a chat panel in their IDE",
    "Be terse and direct. Deliver fact-based progress updates",
    "No acknowledgment phrases: Never start responses with phrases like",
    "You have the ability to call tools in parallel",
    "Prefer minimal, focused edits using the edit or multi_edit tools",
    "Use update_plan to manage work",
    "You have the ability to run terminal commands on the user's machine",
    "You must NEVER NEVER run a command automatically if it could be unsafe",
    "When debugging, only make code changes if you are certain",
    "EXTREMELY IMPORTANT: Your generated code must be immediately runnable",
    "Bug fixing discipline: Prefer minimal upstream fixes",
    "Long-horizon workflow: For multi-session work",
    "Planning cadence: Draft a succinct plan for non-trivial tasks",
    "Testing discipline: Design or update tests before major implementation",
    "Verification tools: Prefer available automated verification",
    "Progress notes: Prefer lightweight workspace artifacts",
];

/// XML section tag patterns that wrap Windsurf system prompt sections
const WINDSURF_XML_TAGS: &[&str] = &[
    "communication_style",
    "communication_guidelines",
    "markdown_formatting",
    "citation_guidelines",
    "tool_calling",
    "making_code_changes",
    "running_commands",
    "debugging",
    "calling_external_apis",
    "workflows",
    "user_rules",
    "user_information",
    "memory_system",
    "ide_metadata",
    "task_management",
    "planning_guidance",
    "additional_metadata",
];

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum StripMode {
    Full,
    Partial,
    None,
}

impl StripMode {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "full" => StripMode::Full,
            "partial" => StripMode::Partial,
            "none" | "off" | "passthrough" => StripMode::None,
            _ => StripMode::Full,
        }
    }
}

/// Strip Windsurf native system prompt content from a message
pub fn strip_system_prompt(content: &str, mode: StripMode) -> String {
    match mode {
        StripMode::None => content.to_string(),
        StripMode::Full => strip_full(content),
        StripMode::Partial => strip_partial(content),
    }
}

/// Full strip: remove all known Windsurf prompt fragments and XML sections
fn strip_full(content: &str) -> String {
    let mut result = content.to_string();

    // Remove XML-tagged sections entirely
    for tag in WINDSURF_XML_TAGS {
        let open = format!("<{}>", tag);
        let close = format!("</{}>", tag);
        if let (Some(start), Some(end_pos)) = (result.find(&open), result.find(&close)) {
            if start < end_pos {
                let end = end_pos + close.len();
                result = format!("{}{}", &result[..start], &result[end..]);
            }
        }
    }

    // Remove known fragments
    for fragment in WINDSURF_PROMPT_FRAGMENTS {
        if let Some(pos) = result.find(fragment) {
            // Find the line containing this fragment and remove it
            let line_start = result[..pos].rfind('\n').map(|p| p + 1).unwrap_or(0);
            let line_end = result[pos..].find('\n').map(|p| pos + p + 1).unwrap_or(result.len());
            result = format!("{}{}", &result[..line_start], &result[line_end..]);
        }
    }

    // Clean up multiple blank lines
    while result.contains("\n\n\n") {
        result = result.replace("\n\n\n", "\n\n");
    }

    result.trim().to_string()
}

/// Partial strip: only remove the core identity and behavioral directives
fn strip_partial(content: &str) -> String {
    let mut result = content.to_string();

    // Only strip core identity
    let core_fragments = &[
        "You are Cascade, a powerful agentic AI coding assistant",
        "You are Cascade, Codeium's powerful agentic AI coding assistant",
        "The USER is interacting with you through a chat panel in their IDE",
    ];

    for fragment in core_fragments {
        if let Some(pos) = result.find(fragment) {
            let line_start = result[..pos].rfind('\n').map(|p| p + 1).unwrap_or(0);
            let line_end = result[pos..].find('\n').map(|p| pos + p + 1).unwrap_or(result.len());
            result = format!("{}{}", &result[..line_start], &result[line_end..]);
        }
    }

    result.trim().to_string()
}

/// Check if content appears to contain Windsurf system prompt
pub fn is_windsurf_prompt(content: &str) -> bool {
    WINDSURF_PROMPT_FRAGMENTS.iter().any(|f| content.contains(f))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_full() {
        let input = "You are Cascade, a powerful agentic AI coding assistant.\n\
                      <communication_style>\nBe terse.\n</communication_style>\n\
                      User message here.";
        let result = strip_system_prompt(input, StripMode::Full);
        assert!(!result.contains("Cascade"));
        assert!(!result.contains("communication_style"));
        assert!(result.contains("User message here"));
    }

    #[test]
    fn test_strip_none() {
        let input = "You are Cascade. Hello!";
        let result = strip_system_prompt(input, StripMode::None);
        assert_eq!(result, input);
    }

    #[test]
    fn test_is_windsurf_prompt() {
        assert!(is_windsurf_prompt("You are Cascade, a powerful agentic AI coding assistant"));
        assert!(!is_windsurf_prompt("You are a helpful assistant"));
    }
}
