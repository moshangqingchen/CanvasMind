const LOCAL_EXECUTION_FIELDS = new Set(["__runtimeConnection", "__runtimeCliConfig", "cli", "cliConfig", "cliStatus", "executable", "args", "argv", "cwd", "env", "environment", "command", "commandTemplate"]);

/** Project documents carry model choices, never trusted local execution settings. */
export function withoutLocalExecutionConfig<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutLocalExecutionConfig) as T;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !LOCAL_EXECUTION_FIELDS.has(key)).map(([key, child]) => [key, withoutLocalExecutionConfig(child)])) as T;
}
