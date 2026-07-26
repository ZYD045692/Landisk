# 日志格式说明

## 结构化 JSON 格式

日志文件 `%USERPROFILE%\.landisk\logs\landisk.log` 每条记录一个 JSON 块：

```json
{
  "ts": "2026-07-22 22:04:50",
  "level": "INFO",
  "type": 1,
  "data": { "op": 1, "dir": "D:\\test", "count": 4, "files": [...] }
}
```

## type 码表

| type | 操作 |
|---|---|
| 1 | 新增 |
| 2 | 替换 |
| 3 | 阻断 |
| 4 | 删除 |
| 5 | 下载 |
| 6 | 打开 |
| 7 | 根目录 |
| 8 | 配置 |
| 9 | 启动 |
| 10 | 浏览 |
| 11 | 日志 |
| 12 | 服务 |

## data.op 码表

### type 1=新增 / 2=替换
```json
{"op": 1, "dir": "D:\\test", "count": 4, "files": [{"name": "a.pdf", "size": "3.5 MB"}]}
```

### type 3=阻断
```json
{"op": 1, "count": 2, "files": ["setup.exe", "install.bat"]}
```

### type 4=删除
| op | 含义 |
|---|---|
| 1 | 回收站 |
| 2 | 永久删除 |
| 3 | 失败 |

```json
{"op": 1, "file": "D:\\a.pdf", "dest": "trash"}
{"op": 2, "file": "D:\\a.pdf", "dest": "permanent"}
{"op": 3, "file": "D:\\a.pdf", "error": "not found"}
```

### type 5=下载
| op | 含义 |
|---|---|
| 1 | 成功 |
| 2 | 失败 |

```json
{"op": 1, "file": "report.pdf", "size": "1.2 MB"}
{"op": 2, "file": "report.pdf", "error": "not found"}
```

### type 6=打开
| op | 含义 |
|---|---|
| 1 | 成功 |
| 2 | 失败 |

```json
{"op": 1, "file": "report.pdf"}
{"op": 2, "file": "report.pdf", "error": "permission denied"}
```

### type 7=根目录
| op | 含义 |
|---|---|
| 1 | 添加 |
| 2 | 移除 |

```json
{"op": 1, "dir": "D:\\Share"}
{"op": 2, "dir": "D:\\OldShare"}
```

### type 8=配置
```json
{"op": 1, "field": "port", "value": 22581}
```

### type 9=启动
```json
{"op": 1, "desc": "local access", "url": "http://localhost:22580"}
```

### type 10=浏览
```json
{"op": 1, "dir": "D:\\Share", "error": "permission denied"}
```

### type 11=日志
```json
{"op": 1}  // 清空全部
{"op": 2}  // 清空缓冲区
```

### type 12=服务
```json
{"op": 1, "error": "xxx is not defined"}
```

## data 通用字段

| 字段 | 说明 | 出现于 type |
|---|---|---|
| `dir` | 目录路径 | 1, 2, 7, 10 |
| `file` | 文件路径或文件名 | 4, 5, 6 |
| `files` | 文件列表 | 1, 2, 3 |
| `dest` | 去向（trash/permanent） | 4 |
| `size` | 文件大小文字 | 1, 2, 5 |
| `error` | 错误原因 | 4, 5, 6, 10, 12 |
| `field` | 配置字段名 | 8 |
| `value` | 配置值 | 8 |
| `desc` | 启动描述 | 9 |
| `url` | 访问地址 | 9 |
