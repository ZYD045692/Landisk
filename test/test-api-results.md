# LanDisk API 测试结果

**时间**: 2026/8/10 11:39:05
**通过: 87 / 87**

| # | 类型 | 操作 | 预期 | verify | 结果 |
|---|---|---|---|---|---|
| 1 | 启动 | 启动日志 type=9 | 含服务地址+编译时间(buildTs) | ✓ | ✅ |
| 2 | 服务信息 | GET /api/server-info | url/buildTs 有，local 无 | ✓ | ✅ |
| 3 | 启动 | 重启后 type=9 共享目录日志 | 含 共享目录 count≥2 | ✓ | ✅ |
| 4 | 文件列表 | GET /testdira/testa | ≥3文件 | ✓ | ✅ |
| 5 | 文件列表 | GET /testdirb/testb | ≥3文件 | ✓ | ✅ |
| 6 | 文件列表 | GET / (虚拟根) | 列出所有根 | ✓ | ✅ |
| 7 | 浏览 | GET /testdira/nonexist | 200 err | ✓ | ✅ |
| 8 | 浏览 | GET /files 无效根 | type=10 op=3 日志 | ✓ | ✅ |
| 9 | 浏览 | GET /files 穿越 /testdira/C:/Windows/... | type=10 op=3 日志 | ✓ | ✅ |
| 10 | 日志 | DELETE /logs/display (清显示) | 200 | ✓ | ✅ |
| 11 | 日志 | DELETE /logs (清空全部) | 200 | ✓ | ✅ |
| 12 | 日志 | POST logs type=4 op=0 (前端删除取消) | 200 | ✓ | ✅ |
| 13 | 上传 | POST new.txt→/testdira/testa | 200 | ✓ | ✅ |
| 14 | 阻断 | POST exe→/testdira/testa | 上传成功 | ✓ | ✅ |
| 15 | 批量上传 | POST 2 files→/testdira/testa | count=2 | ✓ | ✅ |
| 16 | 取消上传 | POST logs type=1 op=0 单文件 | 200 | ✓ | ✅ |
| 17 | 取消上传 | POST logs type=1 op=0 批量 | 200 | ✓ | ✅ |
| 18 | 取消删除 | POST logs type=4 op=0 单文件 | 200 | ✓ | ✅ |
| 19 | 取消删除 | POST logs type=4 op=0 批量 | 200 | ✓ | ✅ |
| 20 | 冲突检测 | POST check new.txt | conflicts含new.txt | ✓ | ✅ |
| 21 | 替换 | 替换new.txt | 内容一致 | ✓ | ✅ |
| 22 | 保留两份 | 同名上传(无replace) | 出现 new (1).txt | ✓ | ✅ |
| 23 | 替换 | 替换目录名 ro_dir | type=2 op=2 日志 | ✓ | ✅ |
| 24 | 上传 | POST check 无效根名 | 400 | ✓ | ✅ |
| 25 | 上传 | POST 穿越路径 | 成功(../已清洗) | ✓ | ✅ |
| 26 | 上传 | POST /upload 无文件 | 没有选择文件 | ✓ | ✅ |
| 27 | 上传 | POST /upload 无效根名 | 无效的根目录 | ✓ | ✅ |
| 28 | 上传 | POST 穿越外逃 /testdira/C:/Windows/... | 无权访问 | ✓ | ✅ |
| 29 | 打开 | POST /testdira/testa/t.txt | 200 | ✓ | ✅ |
| 30 | 打开 | POST /testdira/testa/nonexist | 200 失败 | ✓ | ✅ |
| 31 | 打开 | POST /testdira/testa (目录) | 成功+日志 | ✓ | ✅ |
| 32 | 打开 | POST /api/files/open 无body | 失败 | ✓ | ✅ |
| 33 | 打开 | POST 无效根名 | 失败 | ✓ | ✅ |
| 34 | 打开 | POST 穿越 /testdira/C:/Windows/... | 无权访问 | ✓ | ✅ |
| 35 | 打开 | POST /api/open/logdir | 成功+type=6 op=1 | ✓ | ✅ |
| 36 | 下载 | GET /testdira/testa/f1.txt | 200 | ✓ | ✅ |
| 37 | 下载 | GET /testdirb/testb/f1.txt | 200 | ✓ | ✅ |
| 38 | 下载 | GET /testdira/testa/nonexist.txt | 200 失败 | ✓ | ✅ |
| 39 | 下载 | GET /testdira/testa | 200 失败 | ✓ | ✅ |
| 40 | 下载 | GET 无效根名 | 失败 | ✓ | ✅ |
| 41 | 下载 | GET /download 无path | 请求参数错误 | ✓ | ✅ |
| 42 | 下载 | GET 穿越 /testdira/C:/Windows/... | 无权访问 | ✓ | ✅ |
| 43 | 删除 | DELETE /testdira/testa/f2.txt | dest=trash | ✓ | ✅ |
| 44 | 删除 | DELETE /testdira/testa/nonexist.txt | 200 失败 | ✓ | ✅ |
| 45 | 删除 | DELETE 无效根名 | 失败 | ✓ | ✅ |
| 46 | 删除 | DELETE /delete 无path | 请求参数错误 | ✓ | ✅ |
| 47 | 删除 | DELETE 穿越 /testdira/C:/Windows/... | 无权访问 | ✓ | ✅ |
| 48 | 批量删除 | POST batch /testdira/testa/f3.txt+subdir | 混合删除 | ✓ | ✅ |
| 49 | 删除 | POST batch 空paths | type=4 op=3 日志 | ✓ | ✅ |
| 50 | 删除 | DELETE /testdira/testa | dest=trash | ✓ | ✅ |
| 51 | 删除 | DELETE /testdira/testa(已删) | 200 失败 | ✓ | ✅ |
| 52 | 删除 | DELETE /testdira (根本身) | 失败+磁盘仍在 | ✓ | ✅ |
| 53 | 删除 | POST batch 含 /testdira | 根项失败 | ✓ | ✅ |
| 54 | 根目录 | POST roots 重复添加 (testdira) | 失败 | ✓ | ✅ |
| 55 | 根目录 | POST roots 不存在路径 | 失败 | ✓ | ✅ |
| 56 | 根目录 | POST roots 文件路径 | 失败 | ✓ | ✅ |
| 57 | 根目录 | POST roots 名称重复 | 失败 | ✓ | ✅ |
| 58 | 根目录 | POST roots 无path | 请提供目录路径 | ✓ | ✅ |
| 59 | 根目录 | DELETE roots 不存在路径 | 失败 | ✓ | ✅ |
| 60 | 根目录 | DELETE roots 无path | 请提供目录路径 | ✓ | ✅ |
| 61 | 根目录 | PUT roots/rename testdirb→renamedB | config.json name 更新 | ✓ | ✅ |
| 62 | 根目录 | GET /renamedB/testb (新名有效) | 200 | ✓ | ✅ |
| 63 | 根目录 | GET /testdirb/testb (旧名失效) | 失败 | ✓ | ✅ |
| 64 | 根目录 | PUT rename 无path | 请提供 | ✓ | ✅ |
| 65 | 根目录 | PUT rename 无newName | 请提供 | ✓ | ✅ |
| 66 | 根目录 | PUT rename newName为空 | 名称不能为空 | ✓ | ✅ |
| 67 | 根目录 | PUT rename 不存在路径 | 不在共享列表 | ✓ | ✅ |
| 68 | 根目录 | PUT rename 重名(与testdira) | 名称已存在 | ✓ | ✅ |
| 69 | 根目录 | PUT rename 同名不改 | 成功 | ✓ | ✅ |
| 70 | 根目录 | PUT rename 改回testdirb | config.json 恢复 | ✓ | ✅ |
| 71 | 根目录 | 日志 type=7 op=6 testdirb→renamedB | 存在 | ✓ | ✅ |
| 72 | 配置 | GET /api/config | 含各字段 | ✓ | ✅ |
| 73 | 配置 | PUT config maxFileSizeMB=1 | 200 | ✓ | ✅ |
| 74 | 上传 | POST up_large.bin→/testdirb/testb | 文件过大 | ✓ | ✅ |
| 75 | 配置 | PUT config maxFileSizeMB=500 | 200 | ✓ | ✅ |
| 76 | 配置 | PUT config showHiddenFiles=true | 200 | ✓ | ✅ |
| 77 | 配置 | PUT config showHiddenFiles=false | 200 | ✓ | ✅ |
| 78 | 配置 | PUT config maxFileSizeMB=0 (超范围) | 失败 | ✓ | ✅ |
| 79 | 上传 | POST up_normal.txt→/testdirb/testb testb_up.txt | 200 | ✓ | ✅ |
| 80 | 替换 | 替换/testdirb/testb/f1.txt | 内容一致 | ✓ | ✅ |
| 81 | 批量删除 | POST batch /testdirb/testb/f1.txt+f3.txt | count=2 | ✓ | ✅ |
| 82 | 删除 | DELETE /testdirb/testb/testb_up.txt | dest=trash | ✓ | ✅ |
| 83 | 根目录 | DELETE roots path=testdirb | success=true+config清 | ✓ | ✅ |
| 84 | 根目录 | DELETE roots path=testdira | success=true+config清 | ✓ | ✅ |
| 85 | 上传 | POST /upload 无共享目录 | 请先添加共享目录 | ✓ | ✅ |
| 86 | 删除 | DELETE /delete 无共享目录 | 请先添加共享目录 | ✓ | ✅ |
| 87 | 文件列表 | GET /testdira/testa (根已移除) | 失败 | ✓ | ✅ |

**通过: 87 | 失败: 0 | 总计: 87**

**结论: 全部通过 ✅**
