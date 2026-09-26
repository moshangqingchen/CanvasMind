import { DirectorAdapterRegistry } from "@super-canvas/director";
import { AnthropicMessagesAdapter } from "./anthropic";
import { GoogleGenerateContentAdapter } from "./google";
import { OpenAIChatAdapter } from "./openai-chat";
import { OpenAIResponsesAdapter } from "./openai-responses";

export { DirectorAdapterRegistry } from "@super-canvas/director";

export function createDirectorAdapterRegistry(): DirectorAdapterRegistry {
  const registry = new DirectorAdapterRegistry();
  registry.register(new OpenAIResponsesAdapter("openai-responses"));
  registry.register(new OpenAIResponsesAdapter("xai-responses"));
  registry.register(new OpenAIChatAdapter("openai-chat-completions"));
  registry.register(new OpenAIChatAdapter("generic-openai-compatible"));
  registry.register(new AnthropicMessagesAdapter());
  registry.register(new GoogleGenerateContentAdapter());
  return registry;
}

export const directorAdapterRegistry = createDirectorAdapterRegistry();
