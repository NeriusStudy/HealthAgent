---
name: healthagent-water
description: 处理 HealthAgent 饮水记录。用户表达喝水、饮水、喝了多少毫升时，必须使用 HealthAgent 工具，不得自行声称记录成功。
allowed-tools:
  - healthagent_add_water
  - healthagent_query_today_water
  - healthagent_list_recent_records
  - healthagent_update_water
  - healthagent_delete_water
  - healthagent_get_water_goal
  - healthagent_set_water_goal
---

# HealthAgent 饮水记录

当用户表达自己刚刚喝水、饮用了某个数量的水、需要新增饮水记录时：

1. 必须调用 `healthagent_add_water`。
2. 不允许仅凭自然语言直接回复“已记录”“记录成功”。
3. 只有 `healthagent_add_water` 返回成功后，才能告诉用户记录成功。
4. 如果 Tool 返回失败，必须如实告诉用户失败原因，不得编造成功结果。
5. 禁止自行编造用户今日累计饮水量。
6. 查询今日累计饮水量时，必须调用 `healthagent_query_today_water`，禁止自行计算或编造。
7. `amount_ml` 必须来自用户明确表达的数量。
8. 如果用户没有明确饮水量，先询问多少毫升，不要猜测。
9. 单次饮水量必须大于 0 且不超过 5000 ml。
10. 用户说“刚喝了300毫升”“喝水300ml”“记录300毫升水”等，都属于新增饮水记录。

## 新增饮水

示例：

用户：
刚喝了300毫升

必须调用：

`healthagent_add_water`

参数：

- `amount_ml`: 300
- `drank_at`: 如果用户没有指定时间，由 Tool 使用当前时间

Tool 成功后回复类似：

“已记录 300 毫升。”

Tool 失败后回复失败原因，不得说已经记录成功。


## 查询今日饮水量

当用户表达以下意图时：

- 我今天喝了多少水
- 今天喝了多少
- 今日饮水量
- 今天累计多少毫升
- 我今天一共喝了多少

必须调用 `healthagent_query_today_water`。

禁止根据聊天历史自行相加。
禁止猜测今日累计。
只有 Tool 返回 `success: true` 后，才能告诉用户今日累计值。

回复中的累计量必须直接来自：

`data.total_ml`

如果 Tool 失败，如实告诉用户查询失败原因。


## 查询最近饮水记录

当用户询问：

- 我刚才喝了多少
- 我上一条记录是什么
- 最近几条喝水记录
- 最近喝了多少

必须调用 `healthagent_list_recent_records`。

不得根据聊天历史猜测记录。

当用户说“上一条”时，以 Tool 返回的第一条记录为准。
后续修改或删除上一条记录时，也必须先通过此 Tool 获取真实 record id。


## 修改饮水记录

当用户说：

- 把上一条改成 300 毫升
- 刚才那条应该是 250ml
- 修改最近一条饮水记录

必须先调用 `healthagent_list_recent_records` 获取真实记录。

“上一条”必须使用 Tool 返回的第一条记录的 `id`。

然后调用 `healthagent_update_water`。

禁止自行猜测 record id。
禁止传 user_id。
只有 update Tool 返回 success=true 后才能说修改成功。

## 删除饮水记录

删除属于破坏性操作，必须先确认。

当用户说：

- 删除上一条
- 把刚才那条删掉
- 删除这条饮水记录

先调用 `healthagent_list_recent_records` 获取真实记录，并告诉用户将删除哪一条（饮水量和时间）。

必须询问用户是否确认删除。

只有用户明确回复“确认删除”“确定”“是的，删除”等明确确认后，才调用 `healthagent_delete_water`。

record_id 必须来自真实 Tool 查询结果，禁止猜测。

未经确认不得调用删除 Tool。

只有 delete Tool 返回 success=true 后才能说删除成功。


## 饮水目标

当用户询问：

- 我的饮水目标是多少
- 每天要喝多少水
- 我设置的目标是多少

必须调用 `healthagent_get_water_goal`。
不得自行猜测用户目标。

当用户明确要求：

- 把每日饮水目标设为 2000ml
- 我的目标改成 2500 毫升
- 设置每天喝 1800ml

必须调用 `healthagent_set_water_goal`。

target_ml 必须来自用户明确给出的数值。
禁止传 user_id。

只有 Tool 返回 success=true 后，才能告诉用户目标设置成功。

当用户询问：

- 今天完成目标多少了
- 今天距离目标还差多少

必须分别调用：
1. `healthagent_query_today_water`
2. `healthagent_get_water_goal`

只允许根据这两个 Tool 的真实返回结果计算，不得根据聊天历史猜测。
