# LanDisk API 测试结果

**时间**: 2026/7/30 03:29:18
**通过: 52 / 52**

| # | 类型 | 操作 | 预期 | verify | 结果 |
|---|---|---|---|---|---|
| 1 | 文件列表 | GET /testa root=0 | ≥3文件 | ✓ | ✅ |
| 2 | 文件列表 | GET /testb root=1 | ≥3文件 | ✓ | ✅ |
| 3 | 文件列表 | GET / (无root) | 失败 | ✓ | ✅ |
| 4 | 浏览 | GET /nonexist root=0 | 200 err | ✓ | ✅ |
| 5 | 上传 | POST new.txt→/testa root=0 | 200 | ✓ | ✅ |
| 6 | 阻断 | POST exe→/testa root=0 | 上传成功 | ✓ | ✅ |
| 7 | 批量上传 | POST 2 files→/testa root=0 | count=2 | ✓ | ✅ |
| 8 | 取消上传 | POST logs type=1 op=0 单文件 | 200 | ✓ | ✅ |
| 9 | 取消上传 | POST logs type=1 op=0 批量 | 200 | ✓ | ✅ |
| 10 | 取消删除 | POST logs type=4 op=0 单文件 | 200 | ✓ | ✅ |
| 11 | 取消删除 | POST logs type=4 op=0 批量 | 200 | ✓ | ✅ |
| 12 | 冲突检测 | POST check new.txt root=0 | conflicts含new.txt | ✓ | ✅ |
| 13 | 替换 | 替换new.txt root=0 | 内容一致 | ✓ | ✅ |
| 14 | 保留两份 | 同名上传(无replace) root=0 | 出现 new (1).txt | ✓ | ✅ |
| 15 | 上传 | POST root=999 | 400 | ✓ | ✅ |
| 16 | 上传 | POST 穿越路径 root=0 | 成功(../已清洗) | ✓ | ✅ |
| 17 | 打开 | POST /testa/t.xyz root=0 | 200 | ✓ | ✅ |
| 18 | 打开 | POST /testa/nonexist root=0 | 200 失败 | ✓ | ✅ |
| 19 | 打开 | POST /testa root=0 | 200 失败 | ✓ | ✅ |
| 20 | 打开 | POST /api/files/open 无body | 失败 | ✓ | ✅ |
| 21 | 打开 | POST /testa/t.xyz root=999 | 失败 | ✓ | ✅ |
| 22 | 下载 | GET /testa/f1.txt root=0 | 200 | ✓ | ✅ |
| 23 | 下载 | GET /testb/f1.txt root=1 | 200 | ✓ | ✅ |
| 24 | 下载 | GET /testa/nonexist.txt root=0 | 200 失败 | ✓ | ✅ |
| 25 | 下载 | GET /testa root=0 | 200 失败 | ✓ | ✅ |
| 26 | 下载 | GET /download 无root | 失败 | ✓ | ✅ |
| 27 | 下载 | GET /download root=999 | 失败 | ✓ | ✅ |
| 28 | 删除 | DELETE /testa/f2.txt root=0 | dest=trash | ✓ | ✅ |
| 29 | 删除 | DELETE /testa/nonexist.txt root=0 | 200 失败 | ✓ | ✅ |
| 30 | 删除 | DELETE 无root | 失败 | ✓ | ✅ |
| 31 | 删除 | DELETE root=999 | 失败 | ✓ | ✅ |
| 32 | 批量删除 | POST batch /testa/f3.txt+/testa/subdir root=0 | 混合删除 | ✓ | ✅ |
| 33 | 删除 | DELETE /testa root=0 | dest=trash | ✓ | ✅ |
| 34 | 删除 | DELETE /testa(已删) root=0 | 200 失败 | ✓ | ✅ |
| 35 | 根目录 | POST roots 重复添加 (testdira) | 失败 | ✓ | ✅ |
| 36 | 根目录 | POST roots 不存在路径 | 失败 | ✓ | ✅ |
| 37 | 根目录 | POST roots 文件路径 | 失败 | ✓ | ✅ |
| 38 | 根目录 | DELETE roots 不存在路径 | 失败 | ✓ | ✅ |
| 39 | 配置 | PUT config maxFileSizeMB=1 | 200 | ✓ | ✅ |
| 40 | 上传 | POST up_large.bin→/testb root=1 | 文件过大 | ✓ | ✅ |
| 41 | 配置 | PUT config maxFileSizeMB=500 | 200 | ✓ | ✅ |
| 42 | 配置 | PUT config showHiddenFiles=true | 200 | ✓ | ✅ |
| 43 | 配置 | PUT config showHiddenFiles=false | 200 | ✓ | ✅ |
| 44 | 配置 | PUT config maxFileSizeMB=0 (超范围) | 失败 | ✓ | ✅ |
| 45 | 上传 | POST up_normal.txt→/testb testb_up.txt root=1 | 200 | ✓ | ✅ |
| 46 | 替换 | 替换/testb/f1.txt root=1 | 内容一致 | ✓ | ✅ |
| 47 | 批量删除 | POST batch /testb/f1.txt+f3.txt root=1 | count=2 | ✓ | ✅ |
| 48 | 删除 | DELETE /testb/testb_up.txt root=1 | dest=trash | ✓ | ✅ |
| 49 | 日志 | POST logs type=10 op=2 | 200 | ✓ | ✅ |
| 50 | 根目录 | DELETE roots path=testdirb idx=1 | 200 | ✓ | ✅ |
| 51 | 根目录 | DELETE roots path=testdira idx=0 | 200 | ✓ | ✅ |
| 52 | 文件列表 | GET /testa root=旧0 | 失败 | ✓ | ✅ |

**通过: 52 | 失败: 0 | 总计: 52**

**结论: 全部通过 ✅**
