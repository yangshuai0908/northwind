# Git 远程地址与推送说明

## 问题现象

执行以下命令后，代码并没有推到预期的 `northwind` 仓库：

```bash
git remote add origin git@github.com:yangshuai0908/northwind.git
git branch -M main
git push -u origin main
```

## 原因

`origin` 这个远程在此之前就已经存在（指向 `https://github.com/yangshuai0908/DEMO1.git`）。

`git remote add` **只能新增、不能覆盖**，当同名远程已存在时会直接报错：

```
error: remote origin already exists
```

该命令失败后远程地址并没有改变，所以随后的 `git push -u origin main` 仍然推给了旧的 `DEMO1` 仓库。

## 正确做法

要「修改」已存在的远程地址，应该用 `set-url`，而不是 `remote add`：

```bash
# 1. 修改（而非新增）远程地址
git remote set-url origin git@github.com:yangshuai0908/northwind.git

# 2. 确认当前分支名
git branch -M main

# 3. 推送并建立上游追踪
git push -u origin main
```

## 验证

```bash
git remote -v
```

正确输出应为：

```
origin  git@github.com:yangshuai0908/northwind.git (fetch)
origin  git@github.com:yangshuai0908/northwind.git (push)
```

推送成功后的输出：

```
To github.com:yangshuai0908/northwind.git
 * [new branch]      main -> main
branch 'main' set up to track 'origin/main'
```

以后在该分支上直接 `git push` / `git pull` 即可，无需再指定远程和分支。

## 常用对照

| 目的 | 命令 |
| --- | --- |
| 查看远程 | `git remote -v` |
| 新增远程 | `git remote add origin <url>` |
| 修改远程地址 | `git remote set-url origin <url>` |
| 删除远程 | `git remote remove origin` |
| 设置上游分支 | `git push -u origin main` |

## SSH 连通性自检

推送前可先确认 SSH 密钥是否可用：

```bash
ssh -T git@github.com
```

看到 `Hi <用户名>! You've successfully authenticated...` 即表示认证通过。

## 注意事项：不要提交 .env

`backend/.env` 中含有数据库密码与第三方服务密钥（Neon、Clerk、Stream、ImageKit、Polar 等），属于敏感信息。

推送前务必确认它未被 git 跟踪：

```bash
git ls-files backend/.env
```

- 无输出：安全
- 有输出：说明已被纳入版本控制，需先清理历史记录再推送（仅加入 `.gitignore` 无法删除已提交的敏感信息）

建议在项目根目录 `.gitignore` 中确保包含：

```
.env
.env.local
backend/.env
```
