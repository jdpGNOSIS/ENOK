/**
 * Example Plugin — Character Info
 *
 * Plugin structure pattern:
 * 1. Export `name` (string) — unique display name
 * 2. Export `version` (string|number) — semver or any version identifier
 * 3. Export `init(api)` — called when the plugin is enabled
 * 4. Export `tools` (object|function) — optional static tool definitions
 * 5. Export `unload()` — optional cleanup when plugin is disabled
 */

const name = "Character Info";
const version = "1.0.0";

const tools = {};

function init(api) {
  api.registerTool(
    "character-info",
    "Get details about a character in the current conversation",
    {
      type: "object",
      properties: {
        characterName: {
          type: "string",
          description: "Name of the character to look up",
        },
      },
      required: ["characterName"],
    },
    async (params) => {
      const conversation = api.getConversation();
      if (!Array.isArray(conversation) || conversation.length === 0) {
        return { found: false, message: "No conversation history available." };
      }
      const messages = conversation
        .filter((msg) => msg.role === "assistant" && msg.name === params.characterName)
        .slice(-10);
      if (messages.length === 0) {
        return { found: false, message: `Character "${params.characterName}" not found in recent history.` };
      }
      return {
        found: true,
        characterName: params.characterName,
        recentMessages: messages.map((m) => ({
          content: m.content ? m.content.substring(0, 500) : "",
          timestamp: m.timestamp || null,
        })),
        messageCount: messages.length,
      };
    }
  );

  api.logInfo("Character Info plugin initialized");
}

function unload() {
  console.log("  [plugin:character-info] Unloaded");
}

module.exports = { name, version, init, tools, unload };
