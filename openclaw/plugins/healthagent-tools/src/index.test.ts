import { describe, expect, it } from "vitest";
import entry from "./index.js";
import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";

describe("healthagent-tools", () => {
  it("declares tool metadata", () => {
    expect(getToolPluginMetadata(entry)?.tools.map((tool) => tool.name)).toEqual(["healthagent_add_water", "healthagent_query_today_water", "healthagent_list_recent_records", "healthagent_update_water", "healthagent_delete_water", "healthagent_get_water_goal", "healthagent_set_water_goal"]);
  });
});
