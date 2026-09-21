import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

const addWaterParameters = Type.Object(
  {
    amount_ml: Type.Integer({
      minimum: 1,
      maximum: 5000,
      description: "饮水量，单位毫升",
    }),
    drank_at: Type.Optional(
      Type.String({
        description:
          "饮水时间，ISO 8601 格式，例如 2026-09-21T14:30:00+08:00；省略时使用当前北京时间",
      }),
    ),
  },
  { additionalProperties: false },
);

type BindingRecord = {
  senderHash: string;
  backendUserId: string;
  apiKeyPrefix: string;
  status: "active" | "disabled";
  encryptedApiKey: {
    iv: string;
    tag: string;
    ciphertext: string;
  };
};

type BindingFile = {
  version: 1;
  bindings: BindingRecord[];
};

const healthAgentDir = path.join(os.homedir(), ".openclaw", "healthagent");
const masterKeyPath = path.join(healthAgentDir, "master.key");
const bindingsPath = path.join(healthAgentDir, "bindings.json");
function makeSenderHash(
  channel: string,
  accountId: string,
  senderId: string,
): string {
  return createHash("sha256")
    .update(`${channel}\0${accountId}\0${senderId}`, "utf8")
    .digest("hex");
}


type ResolveApiKeyResult =
  | {
      ok: true;
      apiKey: string;
      backendUserId: string;
      apiKeyPrefix: string;
    }
  | {
      ok: false;
      reason: string;
    };

let bindingWriteQueue: Promise<void> = Promise.resolve();

const bootstrapInFlight = new Map<
  string,
  Promise<ResolveApiKeyResult>
>();

async function loadOrCreateMasterKeyHex(): Promise<string> {
  await mkdir(healthAgentDir, {
    recursive: true,
    mode: 0o700,
  });

  await chmod(healthAgentDir, 0o700);

  try {
    const existing = (
      await readFile(masterKeyPath, "utf8")
    ).trim();

    if (!/^[0-9a-fA-F]{64}$/.test(existing)) {
      throw new Error(
        "HealthAgent 绑定密钥格式错误",
      );
    }

    return existing;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "HealthAgent 绑定密钥格式错误"
    ) {
      throw error;
    }
  }

  const generated = randomBytes(32).toString("hex");

  try {
    await writeFile(
      masterKeyPath,
      generated + "\n",
      {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      },
    );

    await chmod(masterKeyPath, 0o600);

    return generated;
  } catch {
    const existing = (
      await readFile(masterKeyPath, "utf8")
    ).trim();

    if (!/^[0-9a-fA-F]{64}$/.test(existing)) {
      throw new Error(
        "HealthAgent 绑定密钥格式错误",
      );
    }

    return existing;
  }
}

async function readBindingFile(): Promise<BindingFile> {
  try {
    const parsed = JSON.parse(
      await readFile(bindingsPath, "utf8"),
    ) as BindingFile;

    if (
      parsed?.version === 1 &&
      Array.isArray(parsed.bindings)
    ) {
      return parsed;
    }
  } catch {
    // 第一次使用时 bindings.json 不存在是正常情况。
  }

  return {
    version: 1,
    bindings: [],
  };
}

async function readBootstrapSecret(): Promise<string | null> {
  const fromEnvironment =
    process.env.AGENT_BOOTSTRAP_SECRET?.trim();

  if (fromEnvironment) {
    return fromEnvironment;
  }

  const candidates = [
    process.env.HEALTHAGENT_ENV_FILE,
    path.resolve(process.cwd(), ".env"),
    "/workspace/HealthAgent/.env",
  ].filter(
    (value): value is string =>
      typeof value === "string" &&
      value.trim().length > 0,
  );

  for (const candidate of [...new Set(candidates)]) {
    try {
      const text = await readFile(candidate, "utf8");

      for (const line of text.split(/\r?\n/)) {
        const match = line.match(
          /^\s*AGENT_BOOTSTRAP_SECRET\s*=\s*(.*?)\s*$/,
        );

        if (!match) {
          continue;
        }

        let value = match[1].trim();

        if (
          (value.startsWith('"') &&
            value.endsWith('"')) ||
          (value.startsWith("'") &&
            value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }

        if (value) {
          return value;
        }
      }
    } catch {
      // 尝试下一个配置文件。
    }
  }

  return null;
}

function encryptApiKey(
  apiKey: string,
  masterKeyHex: string,
): BindingRecord["encryptedApiKey"] {
  const masterKey = Buffer.from(
    masterKeyHex,
    "hex",
  );

  const iv = randomBytes(12);

  const cipher = createCipheriv(
    "aes-256-gcm",
    masterKey,
    iv,
  );

  const ciphertext = Buffer.concat([
    cipher.update(apiKey, "utf8"),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

async function persistBinding(
  record: BindingRecord,
): Promise<void> {
  const task = bindingWriteQueue.then(
    async () => {
      await mkdir(healthAgentDir, {
        recursive: true,
        mode: 0o700,
      });

      await chmod(healthAgentDir, 0o700);

      const current = await readBindingFile();

      const next: BindingFile = {
        version: 1,
        bindings: [...current.bindings],
      };

      const index = next.bindings.findIndex(
        (item) =>
          item.senderHash === record.senderHash,
      );

      if (index >= 0) {
        next.bindings[index] = record;
      } else {
        next.bindings.push(record);
      }

      const tempPath =
        `${bindingsPath}.${process.pid}.tmp`;

      await writeFile(
        tempPath,
        JSON.stringify(next, null, 2) + "\n",
        {
          encoding: "utf8",
          mode: 0o600,
        },
      );

      await chmod(tempPath, 0o600);
      await rename(tempPath, bindingsPath);
      await chmod(bindingsPath, 0o600);
    },
  );

  bindingWriteQueue = task.then(
    () => undefined,
    () => undefined,
  );

  await task;
}

async function provisionApiKey(
  channel: string,
  accountId: string,
  senderId: string,
  senderHash: string,
  masterKeyHex: string,
): Promise<ResolveApiKeyResult> {
  if (channel !== "openclaw-weixin") {
    return {
      ok: false,
      reason:
        "HealthAgent 自动开户只允许来自微信渠道",
    };
  }

  const bootstrapSecret =
    await readBootstrapSecret();

  if (!bootstrapSecret) {
    return {
      ok: false,
      reason:
        "HealthAgent 自动开户未配置 AGENT_BOOTSTRAP_SECRET",
    };
  }

  const baseUrl = (
    process.env.HEALTHAGENT_API_BASE_URL ??
    "http://127.0.0.1:8000/api/v1"
  ).replace(/\/+$/, "");

  let response: Response;

  try {
    response = await fetch(
      `${baseUrl}/agent/bootstrap`,
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${bootstrapSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: "openclaw-weixin",
          provider_account_id: accountId,

          // 不把原始 senderId 落到后端数据库，
          // 后端只保存稳定哈希。
          external_user_id: senderHash,
        }),
      },
    );
  } catch {
    return {
      ok: false,
      reason:
        "无法连接 HealthAgent 后端，自动开户失败",
    };
  }

  let body: any = null;

  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (response.status === 401) {
    return {
      ok: false,
      reason:
        "HealthAgent 自动开户凭证无效，请检查 AGENT_BOOTSTRAP_SECRET",
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      reason:
        `HealthAgent 自动开户失败（HTTP ${response.status}）`,
    };
  }

  const backendUserId = body?.data?.user_id;
  const apiKey = body?.data?.api_key;
  const apiKeyPrefix = body?.data?.key_prefix;

  if (
    typeof backendUserId !== "string" ||
    !backendUserId ||
    typeof apiKey !== "string" ||
    !apiKey ||
    typeof apiKeyPrefix !== "string" ||
    !apiKeyPrefix
  ) {
    return {
      ok: false,
      reason:
        "HealthAgent 自动开户返回数据格式错误",
    };
  }

  const record: BindingRecord = {
    senderHash,
    backendUserId,
    apiKeyPrefix,
    status: "active",
    encryptedApiKey: encryptApiKey(
      apiKey,
      masterKeyHex,
    ),
  };

  try {
    await persistBinding(record);
  } catch {
    return {
      ok: false,
      reason:
        "HealthAgent 用户已创建，但本地绑定保存失败",
    };
  }

  return {
    ok: true,
    apiKey,
    backendUserId,
    apiKeyPrefix,
  };
}

async function resolveApiKey(
  channel: string,
  accountId: string,
  senderId: string,
): Promise<ResolveApiKeyResult> {
  const senderHash = makeSenderHash(
    channel,
    accountId,
    senderId,
  );

  let masterKeyHex: string;

  try {
    masterKeyHex =
      await loadOrCreateMasterKeyHex();
  } catch {
    return {
      ok: false,
      reason:
        "HealthAgent 本地绑定密钥无法初始化",
    };
  }

  const bindingFile =
    await readBindingFile();

  const existing = bindingFile.bindings.find(
    (item) =>
      item.senderHash === senderHash,
  );

  if (existing?.status === "disabled") {
    return {
      ok: false,
      reason:
        "当前微信账号已被停用",
    };
  }

  if (existing?.status === "active") {
    try {
      const masterKey = Buffer.from(
        masterKeyHex,
        "hex",
      );

      const iv = Buffer.from(
        existing.encryptedApiKey.iv,
        "base64",
      );

      const tag = Buffer.from(
        existing.encryptedApiKey.tag,
        "base64",
      );

      const ciphertext = Buffer.from(
        existing.encryptedApiKey.ciphertext,
        "base64",
      );

      const decipher = createDecipheriv(
        "aes-256-gcm",
        masterKey,
        iv,
      );

      decipher.setAuthTag(tag);

      const apiKey = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");

      return {
        ok: true,
        apiKey,
        backendUserId:
          existing.backendUserId,
        apiKeyPrefix:
          existing.apiKeyPrefix,
      };
    } catch {
      // 本地缓存损坏时自动重新 bootstrap，
      // 不让最终用户手工重新绑定。
    }
  }

  const inFlight =
    bootstrapInFlight.get(senderHash);

  if (inFlight) {
    return await inFlight;
  }

  const task = provisionApiKey(
    channel,
    accountId,
    senderId,
    senderHash,
    masterKeyHex,
  ).finally(() => {
    bootstrapInFlight.delete(senderHash);
  });

  bootstrapInFlight.set(
    senderHash,
    task,
  );

  return await task;
}


function currentShanghaiIso(): string {
  const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000);

  return shifted
    .toISOString()
    .replace("Z", "+08:00");
}


function currentShanghaiDayRange() {
  const now = new Date();

  const shanghaiNow = new Date(
    now.getTime() + 8 * 60 * 60 * 1000,
  );

  const year = shanghaiNow.getUTCFullYear();
  const month = String(
    shanghaiNow.getUTCMonth() + 1,
  ).padStart(2, "0");
  const day = String(
    shanghaiNow.getUTCDate(),
  ).padStart(2, "0");

  const date = `${year}-${month}-${day}`;

  return {
    date,
    start: `${date}T00:00:00.000+08:00`,
    end: `${date}T23:59:59.999+08:00`,
  };
}

const queryTodayParameters = Type.Object(
  {},
  { additionalProperties: false },
);


const listRecentParameters = Type.Object(
  {
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 20,
        description: "返回最近几条饮水记录，默认 5 条",
      }),
    ),
  },
  { additionalProperties: false },
);


const updateWaterParameters = Type.Object(
  {
    record_id: Type.Integer({
      minimum: 1,
      description: "要修改的饮水记录 ID，必须来自真实查询结果",
    }),
    amount_ml: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 5000,
        description: "修改后的饮水量（毫升）",
      }),
    ),
    drank_at: Type.Optional(
      Type.String({
        description: "修改后的饮水时间，ISO 8601 格式",
      }),
    ),
  },
  { additionalProperties: false },
);

const deleteWaterParameters = Type.Object(
  {
    record_id: Type.Integer({
      minimum: 1,
      description: "要删除的饮水记录 ID，必须来自真实查询结果",
    }),
  },
  { additionalProperties: false },
);


const getWaterGoalParameters = Type.Object(
  {},
  { additionalProperties: false },
);

const setWaterGoalParameters = Type.Object(
  {
    target_ml: Type.Integer({
      minimum: 1,
      description: "每日饮水目标，单位毫升",
    }),
  },
  { additionalProperties: false },
);

function toolResult(details: Record<string, unknown>) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(details),
      },
    ],
    details,
  };
}

export default defineToolPlugin({
  id: "healthagent-tools",
  name: "HealthAgent Tools",
  description:
    "Manage HealthAgent water records for the currently authenticated chat user.",

  tools: (tool) => [
    tool({
      name: "healthagent_add_water",
      label: "Add Water Record",
      description:
        "为当前聊天用户新增一条饮水记录。不要传 user_id，用户身份由当前聊天发送者绑定关系决定。",
      parameters: addWaterParameters,

      factory({ toolContext }) {
        const runtimeContext = toolContext as {
          requesterSenderId?: string;
          nativeChannelId?: string;
          messageChannel?: string;
          agentAccountId?: string;
          deliveryContext?: {
            channel?: string;
            accountId?: string;
            to?: string;
          };
        };

        return {
          name: "healthagent_add_water",
          label: "Add Water Record",
          description:
            "为当前聊天用户新增一条饮水记录。",
          parameters: addWaterParameters,
          executionMode: "sequential" as const,

          async execute(_toolCallId, rawParams, signal) {
            const params = rawParams as {
              amount_ml: number;
              drank_at?: string;
            };

            const channel =
              runtimeContext.deliveryContext?.channel?.trim() ||
              runtimeContext.messageChannel?.trim() ||
              "";

            const accountId =
              runtimeContext.deliveryContext?.accountId?.trim() ||
              runtimeContext.agentAccountId?.trim() ||
              "";

            // OpenClaw 原生优先使用 requesterSenderId。
            // 当前 openclaw-weixin 私聊插件没有填 SenderId，
            // 但它会把微信 from_user_id 放到可信的当前路由 to 中。
            const trustedRequesterSenderId =
              runtimeContext.requesterSenderId?.trim() || "";

            const weixinRouteSenderId =
              channel === "openclaw-weixin"
                ? runtimeContext.deliveryContext?.to?.trim() || ""
                : "";

            const senderId =
              trustedRequesterSenderId || weixinRouteSenderId;

            if (
              channel !== "openclaw-weixin" ||
              !senderId ||
              !accountId
            ) {
              return toolResult({
                success: false,
                code: "NO_TRUSTED_SENDER",
                message:
                  "当前请求缺少可信的微信发送者身份，拒绝访问 HealthAgent。",
              });
            }

            const binding = await resolveApiKey(
              channel,
              accountId,
              senderId,
            );

            if (!binding.ok) {
              return toolResult({
                success: false,
                code: "NOT_BOUND",
                message: binding.reason,
              });
            }

            const baseUrl = (
              process.env.HEALTHAGENT_API_BASE_URL ??
              "http://127.0.0.1:8000/api/v1"
            ).replace(/\/+$/, "");

            const drankAt =
              params.drank_at ?? currentShanghaiIso();

            let response: Response;

            try {
              response = await fetch(
                `${baseUrl}/water-records`,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${binding.apiKey}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    amount_ml: params.amount_ml,
                    drank_at: drankAt,
                  }),
                  signal,
                },
              );
            } catch {
              return toolResult({
                success: false,
                code: "BACKEND_UNREACHABLE",
                message:
                  "无法连接 HealthAgent 后端，没有新增饮水记录。",
              });
            }

            let body: unknown = null;

            try {
              body = await response.json();
            } catch {
              body = null;
            }

            if (response.status === 401) {
              return toolResult({
                success: false,
                code: "API_KEY_INVALID",
                message:
                  "HealthAgent 用户凭证已失效，请重新绑定。",
              });
            }

            if (!response.ok) {
              return toolResult({
                success: false,
                code: "BACKEND_ERROR",
                httpStatus: response.status,
                message:
                  "HealthAgent 后端拒绝了请求，没有新增饮水记录。",
              });
            }

            return toolResult({
              success: true,
              message: "饮水记录已新增",
              data: body,
            });
          },
        };
      },
    }),
    tool({
      name: "healthagent_query_today_water",
      label: "Query Today's Water",
      description:
        "查询当前聊天用户今天（北京时间）的饮水总量。不要传 user_id，用户身份由当前聊天发送者绑定关系决定。",
      parameters: queryTodayParameters,

      factory({ toolContext }) {
        const runtimeContext = toolContext as {
          requesterSenderId?: string;
          nativeChannelId?: string;
          messageChannel?: string;
          agentAccountId?: string;
          deliveryContext?: {
            channel?: string;
            accountId?: string;
            to?: string;
          };
        };

        return {
          name: "healthagent_query_today_water",
          label: "Query Today's Water",
          description:
            "查询当前聊天用户今天的饮水总量。",
          parameters: queryTodayParameters,
          executionMode: "sequential" as const,

          async execute(_toolCallId, _rawParams, signal) {
            const channel =
              runtimeContext.deliveryContext?.channel?.trim() ||
              runtimeContext.messageChannel?.trim() ||
              "";

            const accountId =
              runtimeContext.deliveryContext?.accountId?.trim() ||
              runtimeContext.agentAccountId?.trim() ||
              "";

            const trustedRequesterSenderId =
              runtimeContext.requesterSenderId?.trim() || "";

            const weixinRouteSenderId =
              channel === "openclaw-weixin"
                ? runtimeContext.deliveryContext?.to?.trim() || ""
                : "";

            const senderId =
              trustedRequesterSenderId || weixinRouteSenderId;

            if (
              channel !== "openclaw-weixin" ||
              !senderId ||
              !accountId
            ) {
              return toolResult({
                success: false,
                code: "NO_TRUSTED_SENDER",
                message:
                  "当前请求缺少可信的微信发送者身份，拒绝访问 HealthAgent。",
              });
            }

            const binding = await resolveApiKey(
              channel,
              accountId,
              senderId,
            );

            if (!binding.ok) {
              return toolResult({
                success: false,
                code: "NOT_BOUND",
                message: binding.reason,
              });
            }

            const baseUrl = (
              process.env.HEALTHAGENT_API_BASE_URL ??
              "http://127.0.0.1:8000/api/v1"
            ).replace(/\/+$/, "");

            const range = currentShanghaiDayRange();

            let page = 1;
            const pageSize = 200;
            let totalMl = 0;
            let recordCount = 0;

            while (true) {
              const url = new URL(
                `${baseUrl}/water-records/range`,
              );

              url.searchParams.set(
                "start_time",
                range.start,
              );
              url.searchParams.set(
                "end_time",
                range.end,
              );
              url.searchParams.set(
                "page",
                String(page),
              );
              url.searchParams.set(
                "page_size",
                String(pageSize),
              );

              let response: Response;

              try {
                response = await fetch(url, {
                  method: "GET",
                  headers: {
                    Authorization:
                      `Bearer ${binding.apiKey}`,
                  },
                  signal,
                });
              } catch {
                return toolResult({
                  success: false,
                  code: "BACKEND_UNREACHABLE",
                  message:
                    "无法连接 HealthAgent 后端，无法查询今日饮水量。",
                });
              }

              let body: any = null;

              try {
                body = await response.json();
              } catch {
                body = null;
              }

              if (response.status === 401) {
                return toolResult({
                  success: false,
                  code: "API_KEY_INVALID",
                  message:
                    "HealthAgent 用户凭证已失效，请重新绑定。",
                });
              }

              if (!response.ok) {
                return toolResult({
                  success: false,
                  code: "BACKEND_ERROR",
                  httpStatus: response.status,
                  message:
                    "HealthAgent 后端拒绝了查询请求。",
                });
              }

              const records = Array.isArray(
                body?.data?.records,
              )
                ? body.data.records
                : [];

              for (const record of records) {
                const amount = Number(
                  record?.amount_ml,
                );

                if (Number.isFinite(amount)) {
                  totalMl += amount;
                }

                recordCount += 1;
              }

              const total = Number(
                body?.data?.total ?? recordCount,
              );

              if (
                records.length === 0 ||
                recordCount >= total
              ) {
                break;
              }

              page += 1;

              if (page > 1000) {
                return toolResult({
                  success: false,
                  code: "PAGINATION_ERROR",
                  message:
                    "今日饮水记录分页异常，停止查询。",
                });
              }
            }

            return toolResult({
              success: true,
              message: "今日饮水量查询成功",
              data: {
                date: range.date,
                timezone: "Asia/Shanghai",
                total_ml: totalMl,
                record_count: recordCount,
              },
            });
          },
        };
      },
    }),
    tool({
      name: "healthagent_list_recent_records",
      label: "List Recent Water Records",
      description:
        "查询当前聊天用户最近的饮水记录。不要传 user_id。",
      parameters: listRecentParameters,

      factory({ toolContext }) {
        const runtimeContext = toolContext as {
          requesterSenderId?: string;
          nativeChannelId?: string;
          messageChannel?: string;
          agentAccountId?: string;
          deliveryContext?: {
            channel?: string;
            accountId?: string;
            to?: string;
          };
        };

        return {
          name: "healthagent_list_recent_records",
          label: "List Recent Water Records",
          description:
            "查询当前聊天用户最近的饮水记录。",
          parameters: listRecentParameters,
          executionMode: "sequential" as const,

          async execute(_toolCallId, rawParams, signal) {
            const params = rawParams as {
              limit?: number;
            };

            const channel =
              runtimeContext.deliveryContext?.channel?.trim() ||
              runtimeContext.messageChannel?.trim() ||
              "";

            const accountId =
              runtimeContext.deliveryContext?.accountId?.trim() ||
              runtimeContext.agentAccountId?.trim() ||
              "";

            const trustedRequesterSenderId =
              runtimeContext.requesterSenderId?.trim() || "";

            const weixinRouteSenderId =
              channel === "openclaw-weixin"
                ? runtimeContext.deliveryContext?.to?.trim() || ""
                : "";

            const senderId =
              trustedRequesterSenderId || weixinRouteSenderId;

            if (
              channel !== "openclaw-weixin" ||
              !senderId ||
              !accountId
            ) {
              return toolResult({
                success: false,
                code: "NO_TRUSTED_SENDER",
                message:
                  "当前请求缺少可信的微信发送者身份，拒绝访问 HealthAgent。",
              });
            }

            const binding = await resolveApiKey(
              channel,
              accountId,
              senderId,
            );

            if (!binding.ok) {
              return toolResult({
                success: false,
                code: "NOT_BOUND",
                message: binding.reason,
              });
            }

            const baseUrl = (
              process.env.HEALTHAGENT_API_BASE_URL ??
              "http://127.0.0.1:8000/api/v1"
            ).replace(/\/+$/, "");

            const limit = Math.min(
              Math.max(params.limit ?? 5, 1),
              20,
            );

            const url = new URL(
              `${baseUrl}/water-records`,
            );

            url.searchParams.set("page", "1");
            url.searchParams.set(
              "page_size",
              String(limit),
            );

            let response: Response;

            try {
              response = await fetch(url, {
                method: "GET",
                headers: {
                  Authorization:
                    `Bearer ${binding.apiKey}`,
                },
                signal,
              });
            } catch {
              return toolResult({
                success: false,
                code: "BACKEND_UNREACHABLE",
                message:
                  "无法连接 HealthAgent 后端，无法查询最近饮水记录。",
              });
            }

            let body: any = null;

            try {
              body = await response.json();
            } catch {
              body = null;
            }

            if (response.status === 401) {
              return toolResult({
                success: false,
                code: "API_KEY_INVALID",
                message:
                  "HealthAgent 用户凭证已失效，请重新绑定。",
              });
            }

            if (!response.ok) {
              return toolResult({
                success: false,
                code: "BACKEND_ERROR",
                httpStatus: response.status,
                message:
                  "HealthAgent 后端拒绝了查询请求。",
              });
            }

            const records = Array.isArray(
              body?.data?.records,
            )
              ? body.data.records.map((record: any) => ({
                  id: record.id,
                  amount_ml: record.amount_ml,
                  drank_at: record.drank_at,
                }))
              : [];

            return toolResult({
              success: true,
              message: "最近饮水记录查询成功",
              data: {
                records,
              },
            });
          },
        };
      },
    }),

    tool({
      name: "healthagent_update_water",
      label: "Update Water Record",
      description:
        "修改当前聊天用户自己的饮水记录。record_id 必须来自 HealthAgent 查询结果，不接受 user_id。",
      parameters: updateWaterParameters,

      factory({ toolContext }) {
        const runtimeContext = toolContext as {
          requesterSenderId?: string;
          nativeChannelId?: string;
          messageChannel?: string;
          agentAccountId?: string;
          deliveryContext?: {
            channel?: string;
            accountId?: string;
            to?: string;
          };
        };

        return {
          name: "healthagent_update_water",
          label: "Update Water Record",
          description:
            "修改当前聊天用户自己的饮水记录。",
          parameters: updateWaterParameters,
          executionMode: "sequential" as const,

          async execute(_toolCallId, rawParams, signal) {
            const params = rawParams as {
              record_id: number;
              amount_ml?: number;
              drank_at?: string;
            };

            if (
              params.amount_ml === undefined &&
              params.drank_at === undefined
            ) {
              return toolResult({
                success: false,
                code: "INVALID_PARAMS",
                message:
                  "至少需要提供新的饮水量或新的饮水时间。",
              });
            }

            const channel =
              runtimeContext.deliveryContext?.channel?.trim() ||
              runtimeContext.messageChannel?.trim() ||
              "";

            const accountId =
              runtimeContext.deliveryContext?.accountId?.trim() ||
              runtimeContext.agentAccountId?.trim() ||
              "";

            const trustedRequesterSenderId =
              runtimeContext.requesterSenderId?.trim() || "";

            const weixinRouteSenderId =
              channel === "openclaw-weixin"
                ? runtimeContext.deliveryContext?.to?.trim() || ""
                : "";

            const senderId =
              trustedRequesterSenderId || weixinRouteSenderId;

            if (
              channel !== "openclaw-weixin" ||
              !senderId ||
              !accountId
            ) {
              return toolResult({
                success: false,
                code: "NO_TRUSTED_SENDER",
                message:
                  "当前请求缺少可信的微信发送者身份，拒绝访问 HealthAgent。",
              });
            }

            const binding = await resolveApiKey(
              channel,
              accountId,
              senderId,
            );

            if (!binding.ok) {
              return toolResult({
                success: false,
                code: "NOT_BOUND",
                message: binding.reason,
              });
            }

            const baseUrl = (
              process.env.HEALTHAGENT_API_BASE_URL ??
              "http://127.0.0.1:8000/api/v1"
            ).replace(/\/+$/, "");

            const payload: Record<string, unknown> = {};

            if (params.amount_ml !== undefined) {
              payload.amount_ml = params.amount_ml;
            }

            if (params.drank_at !== undefined) {
              payload.drank_at = params.drank_at;
            }

            let response: Response;

            try {
              response = await fetch(
                `${baseUrl}/water-records/${params.record_id}`,
                {
                  method: "PUT",
                  headers: {
                    Authorization:
                      `Bearer ${binding.apiKey}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify(payload),
                  signal,
                },
              );
            } catch {
              return toolResult({
                success: false,
                code: "BACKEND_UNREACHABLE",
                message:
                  "无法连接 HealthAgent 后端，没有修改饮水记录。",
              });
            }

            let body: any = null;

            try {
              body = await response.json();
            } catch {
              body = null;
            }

            if (response.status === 401) {
              return toolResult({
                success: false,
                code: "API_KEY_INVALID",
                message:
                  "HealthAgent 用户凭证已失效，请重新绑定。",
              });
            }

            if (response.status === 403) {
              return toolResult({
                success: false,
                code: "FORBIDDEN",
                message:
                  "无权修改这条饮水记录。",
              });
            }

            if (response.status === 404) {
              return toolResult({
                success: false,
                code: "RECORD_NOT_FOUND",
                message:
                  "没有找到这条饮水记录。",
              });
            }

            if (!response.ok) {
              return toolResult({
                success: false,
                code: "BACKEND_ERROR",
                httpStatus: response.status,
                message:
                  "HealthAgent 后端拒绝了修改请求。",
              });
            }

            const record = body?.data ?? {};

            return toolResult({
              success: true,
              message: "饮水记录已修改",
              data: {
                id: record.id,
                amount_ml: record.amount_ml,
                drank_at: record.drank_at,
              },
            });
          },
        };
      },
    }),

    tool({
      name: "healthagent_delete_water",
      label: "Delete Water Record",
      description:
        "删除当前聊天用户自己的饮水记录。调用前必须得到用户明确确认，record_id 必须来自真实查询结果。",
      parameters: deleteWaterParameters,

      factory({ toolContext }) {
        const runtimeContext = toolContext as {
          requesterSenderId?: string;
          nativeChannelId?: string;
          messageChannel?: string;
          agentAccountId?: string;
          deliveryContext?: {
            channel?: string;
            accountId?: string;
            to?: string;
          };
        };

        return {
          name: "healthagent_delete_water",
          label: "Delete Water Record",
          description:
            "删除当前聊天用户自己的饮水记录。",
          parameters: deleteWaterParameters,
          executionMode: "sequential" as const,

          async execute(_toolCallId, rawParams, signal) {
            const params = rawParams as {
              record_id: number;
            };

            const channel =
              runtimeContext.deliveryContext?.channel?.trim() ||
              runtimeContext.messageChannel?.trim() ||
              "";

            const accountId =
              runtimeContext.deliveryContext?.accountId?.trim() ||
              runtimeContext.agentAccountId?.trim() ||
              "";

            const trustedRequesterSenderId =
              runtimeContext.requesterSenderId?.trim() || "";

            const weixinRouteSenderId =
              channel === "openclaw-weixin"
                ? runtimeContext.deliveryContext?.to?.trim() || ""
                : "";

            const senderId =
              trustedRequesterSenderId || weixinRouteSenderId;

            if (
              channel !== "openclaw-weixin" ||
              !senderId ||
              !accountId
            ) {
              return toolResult({
                success: false,
                code: "NO_TRUSTED_SENDER",
                message:
                  "当前请求缺少可信的微信发送者身份，拒绝访问 HealthAgent。",
              });
            }

            const binding = await resolveApiKey(
              channel,
              accountId,
              senderId,
            );

            if (!binding.ok) {
              return toolResult({
                success: false,
                code: "NOT_BOUND",
                message: binding.reason,
              });
            }

            const baseUrl = (
              process.env.HEALTHAGENT_API_BASE_URL ??
              "http://127.0.0.1:8000/api/v1"
            ).replace(/\/+$/, "");

            let response: Response;

            try {
              response = await fetch(
                `${baseUrl}/water-records/${params.record_id}`,
                {
                  method: "DELETE",
                  headers: {
                    Authorization:
                      `Bearer ${binding.apiKey}`,
                  },
                  signal,
                },
              );
            } catch {
              return toolResult({
                success: false,
                code: "BACKEND_UNREACHABLE",
                message:
                  "无法连接 HealthAgent 后端，没有删除饮水记录。",
              });
            }

            if (response.status === 401) {
              return toolResult({
                success: false,
                code: "API_KEY_INVALID",
                message:
                  "HealthAgent 用户凭证已失效，请重新绑定。",
              });
            }

            if (response.status === 403) {
              return toolResult({
                success: false,
                code: "FORBIDDEN",
                message:
                  "无权删除这条饮水记录。",
              });
            }

            if (response.status === 404) {
              return toolResult({
                success: false,
                code: "RECORD_NOT_FOUND",
                message:
                  "没有找到这条饮水记录。",
              });
            }

            if (!response.ok) {
              return toolResult({
                success: false,
                code: "BACKEND_ERROR",
                httpStatus: response.status,
                message:
                  "HealthAgent 后端拒绝了删除请求。",
              });
            }

            return toolResult({
              success: true,
              message: "饮水记录已删除",
              data: {
                id: params.record_id,
              },
            });
          },
        };
      },
    }),

    tool({
      name: "healthagent_get_water_goal",
      label: "Get Water Goal",
      description:
        "查询当前聊天用户自己的每日饮水目标。不接受 user_id。",
      parameters: getWaterGoalParameters,

      factory({ toolContext }) {
        const runtimeContext = toolContext as {
          requesterSenderId?: string;
          nativeChannelId?: string;
          messageChannel?: string;
          agentAccountId?: string;
          deliveryContext?: {
            channel?: string;
            accountId?: string;
            to?: string;
          };
        };

        return {
          name: "healthagent_get_water_goal",
          label: "Get Water Goal",
          description:
            "查询当前聊天用户的每日饮水目标。",
          parameters: getWaterGoalParameters,
          executionMode: "sequential" as const,

          async execute(_toolCallId, _rawParams, signal) {
            const channel =
              runtimeContext.deliveryContext?.channel?.trim() ||
              runtimeContext.messageChannel?.trim() ||
              "";

            const accountId =
              runtimeContext.deliveryContext?.accountId?.trim() ||
              runtimeContext.agentAccountId?.trim() ||
              "";

            const trustedRequesterSenderId =
              runtimeContext.requesterSenderId?.trim() || "";

            const weixinRouteSenderId =
              channel === "openclaw-weixin"
                ? runtimeContext.deliveryContext?.to?.trim() || ""
                : "";

            const senderId =
              trustedRequesterSenderId || weixinRouteSenderId;

            if (
              channel !== "openclaw-weixin" ||
              !senderId ||
              !accountId
            ) {
              return toolResult({
                success: false,
                code: "NO_TRUSTED_SENDER",
                message:
                  "当前请求缺少可信的微信发送者身份，拒绝访问 HealthAgent。",
              });
            }

            const binding = await resolveApiKey(
              channel,
              accountId,
              senderId,
            );

            if (!binding.ok) {
              return toolResult({
                success: false,
                code: "NOT_BOUND",
                message: binding.reason,
              });
            }

            const baseUrl = (
              process.env.HEALTHAGENT_API_BASE_URL ??
              "http://127.0.0.1:8000/api/v1"
            ).replace(/\/+$/, "");

            let response: Response;

            try {
              response = await fetch(
                `${baseUrl}/water-goals`,
                {
                  method: "GET",
                  headers: {
                    Authorization:
                      `Bearer ${binding.apiKey}`,
                  },
                  signal,
                },
              );
            } catch {
              return toolResult({
                success: false,
                code: "BACKEND_UNREACHABLE",
                message:
                  "无法连接 HealthAgent 后端，无法查询饮水目标。",
              });
            }

            let body: any = null;

            try {
              body = await response.json();
            } catch {
              body = null;
            }

            if (response.status === 401) {
              return toolResult({
                success: false,
                code: "API_KEY_INVALID",
                message:
                  "HealthAgent 用户凭证已失效，请重新绑定。",
              });
            }

            if (!response.ok) {
              return toolResult({
                success: false,
                code: "BACKEND_ERROR",
                httpStatus: response.status,
                message:
                  "HealthAgent 后端拒绝了查询目标请求。",
              });
            }

            if (!body?.data) {
              return toolResult({
                success: true,
                message: "当前尚未设置每日饮水目标",
                data: {
                  target_ml: null,
                },
              });
            }

            return toolResult({
              success: true,
              message: "每日饮水目标查询成功",
              data: {
                target_ml: body.data.target_ml,
              },
            });
          },
        };
      },
    }),

    tool({
      name: "healthagent_set_water_goal",
      label: "Set Water Goal",
      description:
        "设置或修改当前聊天用户自己的每日饮水目标。不接受 user_id。",
      parameters: setWaterGoalParameters,

      factory({ toolContext }) {
        const runtimeContext = toolContext as {
          requesterSenderId?: string;
          nativeChannelId?: string;
          messageChannel?: string;
          agentAccountId?: string;
          deliveryContext?: {
            channel?: string;
            accountId?: string;
            to?: string;
          };
        };

        return {
          name: "healthagent_set_water_goal",
          label: "Set Water Goal",
          description:
            "设置或修改当前聊天用户的每日饮水目标。",
          parameters: setWaterGoalParameters,
          executionMode: "sequential" as const,

          async execute(_toolCallId, rawParams, signal) {
            const params = rawParams as {
              target_ml: number;
            };

            const channel =
              runtimeContext.deliveryContext?.channel?.trim() ||
              runtimeContext.messageChannel?.trim() ||
              "";

            const accountId =
              runtimeContext.deliveryContext?.accountId?.trim() ||
              runtimeContext.agentAccountId?.trim() ||
              "";

            const trustedRequesterSenderId =
              runtimeContext.requesterSenderId?.trim() || "";

            const weixinRouteSenderId =
              channel === "openclaw-weixin"
                ? runtimeContext.deliveryContext?.to?.trim() || ""
                : "";

            const senderId =
              trustedRequesterSenderId || weixinRouteSenderId;

            if (
              channel !== "openclaw-weixin" ||
              !senderId ||
              !accountId
            ) {
              return toolResult({
                success: false,
                code: "NO_TRUSTED_SENDER",
                message:
                  "当前请求缺少可信的微信发送者身份，拒绝访问 HealthAgent。",
              });
            }

            const binding = await resolveApiKey(
              channel,
              accountId,
              senderId,
            );

            if (!binding.ok) {
              return toolResult({
                success: false,
                code: "NOT_BOUND",
                message: binding.reason,
              });
            }

            const baseUrl = (
              process.env.HEALTHAGENT_API_BASE_URL ??
              "http://127.0.0.1:8000/api/v1"
            ).replace(/\/+$/, "");

            let response: Response;

            try {
              response = await fetch(
                `${baseUrl}/water-goals`,
                {
                  method: "PUT",
                  headers: {
                    Authorization:
                      `Bearer ${binding.apiKey}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    target_ml: params.target_ml,
                  }),
                  signal,
                },
              );
            } catch {
              return toolResult({
                success: false,
                code: "BACKEND_UNREACHABLE",
                message:
                  "无法连接 HealthAgent 后端，没有修改饮水目标。",
              });
            }

            let body: any = null;

            try {
              body = await response.json();
            } catch {
              body = null;
            }

            if (response.status === 401) {
              return toolResult({
                success: false,
                code: "API_KEY_INVALID",
                message:
                  "HealthAgent 用户凭证已失效，请重新绑定。",
              });
            }

            if (!response.ok) {
              return toolResult({
                success: false,
                code: "BACKEND_ERROR",
                httpStatus: response.status,
                message:
                  "HealthAgent 后端拒绝了设置目标请求。",
              });
            }

            return toolResult({
              success: true,
              message: "每日饮水目标已设置",
              data: {
                target_ml: body?.data?.target_ml,
              },
            });
          },
        };
      },
    }),
  ],
});
