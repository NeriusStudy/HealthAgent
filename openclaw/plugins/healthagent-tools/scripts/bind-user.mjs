import {
  createCipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const userId = (process.env.HA_USER_ID ?? "").trim();
const password = process.env.HA_PASSWORD ?? "";

if (!userId || !password) {
  throw new Error("缺少 HA_USER_ID 或 HA_PASSWORD");
}

const baseUrl = (
  process.env.HEALTHAGENT_API_BASE_URL ??
  "http://127.0.0.1:8000/api/v1"
).replace(/\/+$/, "");

const dir = path.join(
  os.homedir(),
  ".openclaw",
  "healthagent",
);

const pendingPath = path.join(
  dir,
  "pending-senders.json",
);

const bindingsPath = path.join(
  dir,
  "bindings.json",
);

const masterKeyPath = path.join(
  dir,
  "master.key",
);

function senderHash(channel, accountId, senderId) {
  return createHash("sha256")
    .update(
      `${channel}\0${accountId}\0${senderId}`,
      "utf8",
    )
    .digest("hex");
}

function encryptApiKey(apiKey, masterKey) {
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

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);

  let body = {};
  try {
    body = await response.json();
  } catch {}

  if (!response.ok) {
    const detail =
      body?.detail ??
      body?.message ??
      `HTTP ${response.status}`;

    throw new Error(String(detail));
  }

  return body;
}

await mkdir(dir, {
  recursive: true,
  mode: 0o700,
});

const pending = JSON.parse(
  await readFile(pendingPath, "utf8"),
);

if (!Array.isArray(pending.senders)) {
  throw new Error("pending-senders.json 格式错误");
}

if (pending.senders.length !== 1) {
  throw new Error(
    `当前待绑定微信用户数为 ${pending.senders.length}，要求正好为 1`,
  );
}

const sender = pending.senders[0];

const calculatedSenderHash = senderHash(
  sender.channel,
  sender.accountId,
  sender.senderId,
);

if (
  sender.senderHash &&
  sender.senderHash !== calculatedSenderHash
) {
  throw new Error("senderHash 校验失败");
}

let masterKeyHex;

try {
  masterKeyHex = (
    await readFile(masterKeyPath, "utf8")
  ).trim();
} catch {
  masterKeyHex = randomBytes(32).toString("hex");

  await writeFile(
    masterKeyPath,
    masterKeyHex + "\n",
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
}

if (!/^[0-9a-fA-F]{64}$/.test(masterKeyHex)) {
  throw new Error("master.key 格式错误");
}

let bindings = {
  version: 1,
  bindings: [],
};

try {
  const current = JSON.parse(
    await readFile(bindingsPath, "utf8"),
  );

  if (Array.isArray(current.bindings)) {
    bindings = current;
  }
} catch {}

console.log("1/4 登录 HealthAgent...");

const login = await requestJson(
  `${baseUrl}/auth/password-login`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      user_id: userId,
      password,
    }),
  },
);

const jwt = login?.data?.token;

if (!jwt) {
  throw new Error("登录响应没有 token");
}

console.log("2/4 创建微信 ClawBot 专属 API Key...");

const created = await requestJson(
  `${baseUrl}/api-keys`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "wechat-clawbot",
      expires_at: null,
    }),
  },
);

const apiKey = created?.data?.api_key;
const apiKeyPrefix = created?.data?.key_prefix;

if (!apiKey || !apiKeyPrefix) {
  throw new Error("创建 API Key 响应缺少字段");
}

console.log("3/4 验证 API Key 所属用户...");

const me = await requestJson(
  `${baseUrl}/auth/me`,
  {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  },
);

if (me?.data?.user_id !== userId) {
  throw new Error("API Key 所属用户校验失败");
}

const masterKey = Buffer.from(
  masterKeyHex,
  "hex",
);

const record = {
  senderHash: calculatedSenderHash,
  backendUserId: userId,
  apiKeyPrefix,
  status: "active",
  encryptedApiKey: encryptApiKey(
    apiKey,
    masterKey,
  ),
};

const index = bindings.bindings.findIndex(
  (item) =>
    item.senderHash === calculatedSenderHash,
);

if (index >= 0) {
  bindings.bindings[index] = record;
} else {
  bindings.bindings.push(record);
}

const tmp = `${bindingsPath}.tmp`;

await writeFile(
  tmp,
  JSON.stringify(bindings, null, 2) + "\n",
  {
    encoding: "utf8",
    mode: 0o600,
  },
);

await chmod(tmp, 0o600);
await rename(tmp, bindingsPath);
await chmod(bindingsPath, 0o600);

pending.senders = pending.senders.filter(
  (item) =>
    item.senderHash !== calculatedSenderHash,
);

await writeFile(
  pendingPath,
  JSON.stringify(pending, null, 2) + "\n",
  {
    encoding: "utf8",
    mode: 0o600,
  },
);

await chmod(pendingPath, 0o600);

console.log("4/4 绑定完成");
console.log("HealthAgent user:", userId);
console.log("API Key prefix:", apiKeyPrefix);
console.log("完整 API Key 未输出，已使用 AES-256-GCM 加密保存");
