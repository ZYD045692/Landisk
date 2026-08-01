# 日志格式说明

## 结构化 JSON 格式

每条日志记录为一行 JSON 写入 `<数据目录>/logs/landisk.log`（数据目录 = `LANDISK_DATA_DIR` 环境变量或程序所在目录）：

```json
{"ts":"2026-07-29 18:33:58","level":"INFO","type":5,"data":{"op":1,"file":"report.pdf","size":"1.2 MB"},"msg":""}
{"ts":"2026-07-29 18:33:58","level":"WARN","type":5,"data":{"op":2,"file":"report.pdf","error":"系统找不到指定的文件"},"msg":""}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `ts` | string | 时间戳 `YYYY-MM-DD HH:mm:ss` |
| `level` | string | `INFO` / `WARN` / `ERROR` |
| `type` | number | 操作类型，见下方各节 |
| `data` | object | 结构化数据，见各 type 说明 |
| `msg` | string | 日志原文（冗余字段，展示用） |

所有输出**左对齐**。日志查看器渲染格式：

```
YYYY-MM-DD HH:mm:ss LEVEL [TAG] 操作描述
```

---

## 快速跳转

| | | |
|---|---|---|
| [1 新增](#新增-type1) | [5 下载](#下载-type5) | [9 启动](#启动-type9) |
| [2 替换](#替换-type2) | [6 打开](#打开-type6) | [10 浏览](#浏览-type10) |
| [4 删除](#删除-type4) | [7 根目录](#根目录-type7) | [11 日志](#日志-type11) |
| [8 配置](#配置-type8) | [12 服务](#服务-type12) | |

---

## 操作类型

### 新增 (type=1)

写入由前端(`op=0`)或后端(`op=1/2`)写入。

**op 码表**

| op | 含义 | 写入方 |
|---|---|---|
| 0 | 已取消（上传弹窗中取消） | 前端 |
| 1 | 新增成功 | 后端 |
| 2 | 新增失败 | 后端 |

**JSON 格式**

新增成功：
```json
{"op":1,"dir":"D:\\test\\sub","count":4,"files":[{"name":"a.pdf","size":"3.5 MB"}],"root":"D:\\test"}
```

新增失败：
```json
{"op":2,"file":"bigfile.iso","error":"文件过大，最大允许 500 MB","root":"D:\\test"}
```

取消（前端写入）：
```json
{"op":0,"count":3,"files":["f1.txt","f2.txt","f3.txt"],"dir":"/subdir","root":"D:\\test"}
{"op":0,"file":"f1.txt","dir":"/subdir","root":"D:\\test"}
```

**渲染效果**

```
2026-07-29 18:33:58 INFO [新增] 成功 → subdir
photo.jpg (2.3 MB)
```

```
2026-07-29 18:33:58 INFO [新增] 成功(3项) → subdir
a.jpg (1 MB)
b.pdf (512 KB)
c.png (2 MB)
```

```
2026-07-29 18:33:58 WARN [新增] 上传失败
bigfile.iso
文件过大，最大允许 100 MB
```

```
2026-07-29 18:33:58 ERROR [新增] 上传失败
critical.doc
其他原因
```

**取消（批量）**：
```
2026-07-29 18:33:58 INFO [新增] 已取消(3项)
f1.txt
f2.txt
f3.txt
```

**取消（单文件）**：
```
2026-07-29 18:33:58 INFO [新增] 已取消
f1.txt
```

---

### 替换 (type=2)

由后端写入（`op=1/2`）。

**op 码表**

| op | 含义 | 写入方 |
|---|---|---|
| 1 | 替换成功 | 后端 |
| 2 | 替换失败 | 后端 |

**JSON 格式**

替换成功：
```json
{"op":1,"dir":"D:\\test\\sub","count":2,"files":[{"name":"b.doc","size":"512 KB"}],"root":"D:\\test"}
```

**渲染效果**

```
2026-07-29 18:33:58 INFO [替换] 已替换(2项) → subdir
report.pdf (1.5 MB)
old.doc (500 KB)
```

---

### 删除 (type=4)

由前端（`op=0`）或后端（`op=1/2/3`）写入。

**op 码表**

| op | 含义 | 写入方 |
|---|---|---|
| 0 | 已取消 | 前端 |
| 1 | 单文件成功 / 批量成功（回收站） | 后端 |
| 2 | 永久删除成功 | 后端 |
| 3 | 失败 | 后端 |

**JSON 格式**

取消（前端）：
```json
{"op":0,"file":"test.txt","root":"D:\\test"}
{"op":0,"count":5,"root":"D:\\test"}
```

回收站成功：
```json
{"op":1,"count":5,"dir":"D:\\test\\sub","files":[{"name":"a.pdf"},{"name":"b.txt"}],"dest":"trash","root":"D:\\test"}
```

永久删除成功：
```json
{"op":2,"count":5,"dir":"D:\\test\\sub","files":[{"name":"a.pdf"},{"name":"b.txt"}],"dest":"permanent","root":"D:\\test"}
```

失败：
```json
{"op":3,"file":"test.txt","error":"系统找不到指定的文件","root":"D:\\test"}
{"op":3,"file":"myfolder/","error":"系统找不到指定的文件夹","root":"D:\\test","is_dir":true}
```

> 批量删除时：成功写一条聚合日志（op=1 或 op=2），每条失败各写一条独立日志（op=3）。

**渲染效果**

单文件 — 回收站：
```
2026-07-29 18:33:58 INFO [删除] 成功 → 回收站
test.txt
```

单文件 — 永久删除：
```
2026-07-29 18:33:58 INFO [删除] 已永久删除
test.txt
```

批量 — 回收站：
```
2026-07-29 18:33:58 INFO [删除] 成功(5项) → 回收站
a.txt
b.pdf
c.jpg
d.docx
e.zip
```

批量 — 永久删除：
```
2026-07-29 18:33:58 INFO [删除] 已永久删除(5项)
a.txt
b.pdf
c.jpg
d.docx
e.zip
```

批量 — 部分失败（6 成功 2 失败）：
```
2026-07-29 18:33:58 INFO [删除] 成功(6项) → 回收站
a.txt
b.pdf
c.jpg
d.docx
e.zip
f.png
```

```
2026-07-29 18:33:58 WARN [删除] 删除失败
deleted1.txt
系统找不到指定的文件
```

```
2026-07-29 18:33:58 WARN [删除] 删除失败
deleted2.txt
系统找不到指定的文件
```

取消：
```
2026-07-29 18:33:58 INFO [删除] 已取消
test.txt
```

批量取消：
```
2026-07-29 18:33:58 INFO [删除] 已取消 (5项)
test.txt
other.doc
```

---

### 下载 (type=5)

由后端写入。

**op 码表**

| op | 含义 |
|---|---|
| 1 | 成功 |
| 2 | 失败 |

**JSON 格式**

成功：
```json
{"op":1,"file":"/test/report.pdf","size":"1.5 MB","root":"D:\\test"}
```

失败：
```json
{"op":2,"file":"/test/report.pdf","error":"系统找不到指定的文件"}
{"op":2,"file":"myfolder/","error":"不能下载目录","is_dir":true}
{"op":2,"file":"/test/../secret.txt","error":"无权访问该路径"}
{"op":2,"file":"","error":"请求参数错误"}
{"op":2,"file":"/test/report.pdf","error":"其他原因","root":"D:\\test"}
```

**渲染效果**

```
2026-07-29 18:33:58 INFO [下载] report.pdf (1.2 MB)
```

```
2026-07-29 18:33:58 WARN [下载] 下载失败
report.pdf
系统找不到指定的文件
```

```
2026-07-29 18:33:58 WARN [下载] 下载失败
myfolder/
不能下载目录
```

---

### 打开 (type=6)

由后端写入。

**op 码表**

| op | 含义 |
|---|---|
| 1 | 成功 |
| 2 | 失败 |

**JSON 格式**

```json
{"op":1,"file":"report.pdf","root":"D:\\test"}
{"op":2,"file":"report.pdf","error":"系统找不到指定的文件","root":"D:\\test"}
{"op":2,"file":"myfolder/","error":"不能打开目录","root":"D:\\test"}
{"op":2,"file":"...","error":"无权访问该路径","root":"D:\\test"}
{"op":2,"file":"report.pdf","error":"其他原因","root":"D:\\test"}
```

**渲染效果**

```
2026-07-29 18:33:58 INFO [打开] report.pdf
```

```
2026-07-29 18:33:58 WARN [打开] 打开失败
report.pdf
系统找不到指定的文件
```

---

### 根目录 (type=7)

由后端写入。

**op 码表**

| op | 含义 |
|---|---|
| 0 | 启动加载 |
| 1 | 添加成功 |
| 2 | 移除成功 |
| 3 | 添加失败 |
| 4 | 移除失败 |

**JSON 格式**

成功：
```json
{"op":0,"dir":"D:\\Share"}
{"op":1,"dir":"D:\\Share"}
{"op":2,"dir":"D:\\OldShare"}
```

失败：
```json
{"op":3,"dir":"D:\\NotExist","error":"目录不存在或无权限访问"}
{"op":3,"dir":"D:\\Share","error":"该目录已在共享列表中"}
{"op":3,"dir":"D:\\Share","error":"请输入绝对路径，如 D:\\Share"}
{"op":3,"dir":"C:\\Windows\\notepad.exe","error":"路径不是目录"}
{"op":3,"dir":"D:\\Share","error":"保存配置失败: 权限不足"}
{"op":4,"dir":"D:\\NotShared","error":"该目录不在共享列表中"}
{"op":4,"dir":"D:\\Share","error":"保存配置失败: 权限不足"}
```

**渲染效果**

添加成功：
```
2026-07-29 18:33:58 INFO [根目录] 添加成功
D:\Share
```

添加失败：
```
2026-07-29 18:33:58 WARN [根目录] 添加失败
D:\NotExist
目录不存在或无权限访问
```
```
2026-07-29 18:33:58 WARN [根目录] 添加失败
D:\Share
该目录已在共享列表中
```
```
2026-07-29 18:33:58 ERROR [根目录] 添加失败
D:\Share
保存配置失败: 权限不足
```

移除成功：
```
2026-07-29 18:33:58 INFO [根目录] 移除成功
D:\OldShare
```

移除失败：
```
2026-07-29 18:33:58 WARN [根目录] 移除失败
D:\NotShared
该目录不在共享列表中
```

---

### 配置 (type=8)

由后端写入。

**op 码表**

| op | 含义 |
|---|---|
| 1 | 修改成功 |
| 2 | 保存失败 |

**JSON 格式**

修改成功：
```json
{"op":1,"field":"maxFileSizeMB","ori":500,"now":1000}
{"op":1,"field":"showHiddenFiles","ori":true,"now":false}
```

保存失败：
```json
{"op":2,"field":"maxFileSizeMB","error":"保存配置失败: 写入磁盘权限不足"}
{"op":2,"field":"maxFileSizeMB","error":"文件大小上限必须在 1-9999 MB 之间"}
```

**渲染效果**

数值变更：
```
2026-07-29 18:33:58 INFO [配置] 最大上传 (MB) 已修改
500 → 600 MB
```

开关开启：
```
2026-07-29 18:33:58 INFO [配置] 显示隐藏文件已开启
```

开关关闭：
```
2026-07-29 18:33:58 INFO [配置] 开机自启已关闭
```

保存失败：
```
2026-07-29 18:33:58 ERROR [配置] 配置 修改失败
写入磁盘权限不足
```

范围校验失败：
```
2026-07-29 18:33:58 WARN [配置] 最大上传 (MB) 修改失败
文件大小上限必须在 1-9999 MB 之间
```

---

### 启动 (type=9)

由后端写入。

**JSON 格式**

```json
{"op":1,"desc":"服务地址","url":"http://192.168.1.12:22580"}
{"op":1,"desc":"共享目录","count":2,"dirs":["D:\\Share1","D:\\Share2"]}
```

**渲染效果**

```
2026-07-29 18:33:58 INFO [启动] 服务地址 : http://192.168.1.12:22580
```

```
2026-07-29 18:33:58 INFO [启动] 共享目录 2 个
D:\Share1
D:\Share2
```

---

### 浏览 (type=10)

由前端（`op=2`）或后端（`op=3`）写入。

**op 码表**

| op | 含义 | 写入方 |
|---|---|---|
| 2 | 根目录切换 | 前端 |
| 3 | 打开失败 | 后端 |

**JSON 格式**

```json
{"op":2,"dir":"我的文档","root":"D:\\Share"}
{"op":3,"dir":"/subdir","error":"系统找不到指定的文件夹","root":"D:\\Share"}
{"op":3,"dir":"/restricted","error":"没有权限访问","root":"D:\\Share"}
```

**渲染效果**

```
2026-07-29 18:33:58 INFO [浏览] 切换 → subdir
```

```
2026-07-29 18:33:58 WARN [浏览] 打开失败
subdir
系统找不到指定的文件夹
```

---

### 日志 (type=11)

由后端写入。

**op 码表**

| op | 含义 |
|---|---|
| 1 | 清空全部（含文件） |
| 2 | 清空显示缓冲区 |

**JSON 格式**

```json
{"op":1}
{"op":2}
```

**渲染效果**

```
2026-07-29 18:33:58 INFO [日志] 已清空
```

```
2026-07-29 18:33:58 INFO [日志] 缓冲区已清空
```

---

### 服务 (type=12)

暂未使用。

---

## data 通用字段

| 字段 | 类型 | 说明 | 出现于 type |
|---|---|---|---|
| `dir` | string | 目录路径 | 1, 2, 4, 5, 7, 10 |
| `file` | string | 文件名（从路径中提取） | 1, 4, 5, 6 |
| `files` | array | 文件列表 `[{name, size?}]` | 1, 2, 4, 5 |
| `count` | number | 数量 | 1, 2, 4, 5 |
| `dest` | string | 去向 `trash` / `permanent` | 4 |
| `root` | string | 共享目录完整路径 | 1, 2, 4, 5, 6, 10 |
| `size` | string | 文件大小文字（如 "1.5 MB"） | 1, 2, 5 |
| `error` | string | 用户可读的错误原因 | 1, 4, 5, 6, 7, 8, 10 |
| `field` | string | 配置字段名 | 8 |
| `ori` | any | 配置原值 | 8 |
| `now` | any | 配置新值 | 8 |
| `desc` | string | 启动阶段描述 | 9 |
| `url` | string | 访问地址 | 9 |
| `dirs` | array | 共享目录列表 | 9 |
| `is_dir` | boolean | 是否为目录 | 4, 5 |

---

## 说明

1. **所有操作日志均由后端 Rust handler 写入**，前端不再通过 `POST /api/logs` 写操作日志
2. **唯一例外**：`type=1 op=0`（上传取消）、`type=4 op=0`（删除取消）、`type=10 op=2`（根目录切换）由前端写入，属于界面行为而非文件操作
3. **日志查看器渲染**：所有文本左对齐
4. **错误消息**：`error` 字段为用户可读的中文消息，由后端根据具体错误原因生成；未知错误统一归为 `"其他原因"`
5. **批量操作日志**（`type=4`）：成功写一条聚合日志，失败每条各写一条独立日志
6. **写入方**：
   - `type 1/2/4/5/6/7/8/9/11/12` — 后端
   - `type 10 op=2` — 前端
   - `type 10 op=3` — 后端
