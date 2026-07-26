# LanDisk API 测试结果

**时间**: 2026/7/27 05:01:21
**通过: 23 / 23**

| # | 类型 | 操作 | 预期 | verify | 结果 |
|---|---|---|---|---|---|
| 1 | 文件列表 | GET /api/files?path=/testa&root=0 | 200,≥3条 | ✓ | ✅ |
| 2 | 文件列表 | GET /api/files?path=/testb&root=1 | 200,≥3条 | ✓ | ✅ |
| 3 | 缺 root | GET /api/files (无root) | 400 | ✓ | ✅ |
| 4 | 上传 | POST new.txt→/testa root=0 | 200 | ✓ | ✅ |
| 5 | 阻断 | POST exe→/testa root=0 | 200阻断 | ✓ | ✅ |
| 6 | 冲突检测 | POST check new.txt root=0 | conflicts含new.txt | ✓ | ✅ |
| 7 | 替换+对比 | 替换new.txt | 替换后内容一致 | ✓ | ✅ |
| 8 | 保留两份 | 同名上传(无replace) | 出现new(1).txt | ✓ | ✅ |
| 9 | 取消 | 检测不存在文件 | conflicts空 | ✓ | ✅ |
| 10 | 缺 root | POST upload/check (无root) | 400 | ✓ | ✅ |
| 11 | 打开文件 | POST open /testa/t.xyz root=0 | 200 | ✓ | ✅ |
| 12 | 缺 root | POST open (无root) | 400 | ✓ | ✅ |
| 13 | 下载 | GET download /testa/f1.txt root=0 | 200 | ✓ | ✅ |
| 14 | 下载 | GET download /testb/f1.txt root=1 | 200 | ✓ | ✅ |
| 15 | 缺 root | GET download (无root) | 400 | ✓ | ✅ |
| 16 | test_b替换 | 替换testb/f1.txt | 替换后内容一致 | ✓ | ✅ |
| 17 | 删除 | DELETE /testa/f2.txt root=0 | 200 dest=trash | ✓ | ✅ |
| 18 | 缺 root | DELETE (无root) | 400 | ✓ | ✅ |
| 19 | 日志 | POST logs type=10 | 200 | ✓ | ✅ |
| 20 | 删目录 | DELETE /testa root=0 | 200 目录已删 | ✓ | ✅ |
| 21 | 根目录 | DELETE roots path=testdirb | 200 config无testdirb | ✓ | ✅ |
| 22 | 根目录 | DELETE roots path=testdira | 200 config无testdira | ✓ | ✅ |
| 23 | 缺 root | GET /api/files root=旧0 | 400 | ✓ | ✅ |

**通过: 23 | 失败: 0 | 总计: 23**

**结论: 全部通过 ✅**
