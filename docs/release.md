# 发布检查清单

本文档介绍稳定版和每日构建版桌面应用的统一发布工作流。

## 工作流功能

- 工作流文件：`.github/workflows/release.yml`
- 触发条件：
  - 推送匹配 `v*.*.*` 的标签时触发稳定版发布
  - 每日定时构建于 `09:00 UTC` 触发
  - 手动触发 `workflow_dispatch` 可选择任一渠道
- 首先运行质量检查：lint、typecheck、test。
- 并行构建四个平台的产物（两个渠道均适用）：
  - macOS `arm64` DMG
  - macOS `x64` DMG
  - Linux `x64` AppImage
  - Windows `x64` NSIS 安装包
- 发布一个包含所有产物的 GitHub Release。
  - 带有 `X.Y.Z` 后缀的稳定版标签（例如 `1.2.3-alpha.1`）会作为 GitHub 预发布版本发布。
  - 只有纯稳定版 `X.Y.Z` 才会标记为仓库的最新版本。
  - 每日构建始终是 GitHub 预发布版本，永远不会标记为最新版本。
  - 自动生成的发布说明会固定到同一渠道的上一个标签，因此稳定版会与上一个稳定版标签比较，每日构建版会与上一个每日构建标签比较。
- 在发布产物中包含 Electron 自动更新元数据（例如 `latest*.yml`、`nightly*.yml` 和 `*.blockmap`）。
- 使用 OIDC 可信发布从同一工作流文件发布 CLI 包（`apps/server`，npm 包名 `t3`）：
  - 稳定版发布到 npm dist-tag `latest`
  - 每日构建版发布到 npm dist-tag `nightly`
- 代码签名是可选的，会根据 secrets 自动检测各平台是否启用。

## 每日构建

- 工作流文件：`.github/workflows/release.yml`
- 触发条件：
  - 每天定时于 `09:00 UTC` 触发
  - 手动触发 `workflow_dispatch` 并设置 `channel=nightly`
- 运行与标签发布流程相同的桌面质量检查和产物矩阵。
- 仅发布 GitHub 预发布版本：
  - 标签格式：`nightly-vX.Y.Z-nightly.YYYYMMDD.<run_number>`
  - 发布名称包含简短的 commit SHA
  - `make_latest` 始终为 `false`
- 使用下一个稳定补丁版本作为每日构建的基础版本。例如，`0.0.17` 会生成 `0.0.18-nightly.*` 的每日构建版本。
- 将 Electron 自动更新元数据发布到专用的 `nightly` 更新渠道，以便桌面用户可以独立于稳定版选择该渠道。
- 使用相同的每日构建版本号将 CLI 包（`apps/server`，npm 包名 `t3`）发布到 `nightly` npm dist-tag。
- 不会将版本号变更提交回 `main` 分支。

## 桌面应用自动更新说明

- 运行时更新器：`apps/desktop/src/main.ts` 中的 `electron-updater`。
- 更新用户体验：
  - 启动延迟后定期在后台检查更新。
  - 不会自动下载或安装。
  - 当有可用更新时，桌面 UI 会显示一个火箭更新按钮；点击一次下载，下载完成后再次点击重启并安装。
- 更新源：构建时配置的 GitHub Releases（`provider: github`）。
- 仓库标识来源：
  - 如果设置了 `T3CODE_DESKTOP_UPDATE_REPOSITORY`（格式为 `owner/repo`）。
  - 否则使用 GitHub Actions 中的 `GITHUB_REPOSITORY`。
- 私有仓库的临时认证方案：
  - 在桌面应用运行时环境中设置 `T3CODE_DESKTOP_UPDATE_GITHUB_TOKEN`（或 `GH_TOKEN`）。
  - 应用会将其作为 `Authorization: Bearer <token>` 请求头转发给更新器的 HTTP 请求。
- 更新器所需的发布产物：
  - 平台安装包（`.exe`、`.dmg`、`.AppImage`，以及 macOS 的 `.zip` 用于 Squirrel.Mac 更新负载）
  - 渠道元数据：稳定版为 `latest*.yml`，每日构建版为 `nightly*.yml`
  - `*.blockmap` 文件（用于差量下载）
- macOS 元数据说明：
  - `electron-updater` 在稳定版读取 `latest-mac.yml`，在每日构建版读取 `nightly-mac.yml`，Intel 和 Apple Silicon 通用。
  - 工作流在发布 GitHub Release 之前会将各架构的 Mac 清单合并为一个渠道特定的 Mac 清单。

## 0) npm OIDC 可信发布设置（CLI）

工作流在将 `apps/server` 的包版本更新为发布标签版本后，使用 `npm publish` 发布 CLI。

检查清单：

1. 确认 npm 组织/用户拥有包 `t3`（如需要请先重命名包）。
2. 在 npm 包设置中配置可信发布者：
   - 提供者：GitHub Actions
   - 仓库：本仓库
   - 工作流文件：`.github/workflows/release.yml`
   - 环境（如使用）：与你的 npm 可信发布配置匹配
3. 确保 npm 账户和组织策略允许该包的可信发布。
4. 创建发布标签 `vX.Y.Z` 并推送；工作流将：
   - 将 `apps/server/package.json` 版本设置为 `X.Y.Z`
   - 构建 web + server
   - 运行 `npm publish --access public --tag latest`
5. 同一工作流文件的每日构建使用 `npm publish --access public --tag nightly` 发布。

## 1) 无签名的模拟发布

首先使用此流程验证发布管道。

1. 确认此测试不需要签名 secrets。
2. 创建测试标签：
   - `git tag v0.0.0-test.1`
   - `git push origin v0.0.0-test.1`
3. 等待 `.github/workflows/release.yml` 完成。
4. 验证 GitHub Release 包含所有平台的产物。
5. 下载各产物并在各操作系统上验证安装。

## 2) Apple 签名 + 公证设置（macOS）

工作流所需的 secrets：

- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `APPLE_API_KEY`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

检查清单：

1. Apple Developer 账户访问权限：
   - 团队有权创建 Developer ID 证书。
2. 创建 `Developer ID Application` 证书。
3. 从钥匙串导出证书和私钥为 `.p12` 文件。
4. 将 `.p12` 文件进行 Base64 编码并存储为 `CSC_LINK`。
5. 将 `.p12` 导出密码存储为 `CSC_KEY_PASSWORD`。
6. 在 App Store Connect 中创建 API 密钥（Team key）。
7. 添加 API 密钥值：
   - `APPLE_API_KEY`：下载的 `.p8` 文件内容
   - `APPLE_API_KEY_ID`：密钥 ID
   - `APPLE_API_ISSUER`：发行者 ID
8. 重新运行标签发布并确认 macOS 产物已签名/公证。

备注：

- `APPLE_API_KEY` 以原始密钥文本形式存储在 secrets 中。
- 工作流在运行时将其写入临时文件 `AuthKey_<id>.p8`。

## 3) Azure 可信签名设置（Windows）

工作流所需的 secrets：

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `AZURE_TRUSTED_SIGNING_ENDPOINT`
- `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`
- `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME`
- `AZURE_TRUSTED_SIGNING_PUBLISHER_NAME`

检查清单：

1. 创建 Azure Trusted Signing 账户和证书配置文件。
2. 记录 ATS 值：
   - Endpoint（端点）
   - Account name（账户名称）
   - Certificate profile name（证书配置文件名称）
   - Publisher name（发布者名称）
3. 创建/选择 Entra 应用注册（服务主体）。
4. 授予服务主体 Trusted Signing 所需的权限。
5. 为服务主体创建客户端密钥。
6. 在 GitHub Actions secrets 中添加上述 Azure secrets。
7. 重新运行标签发布并确认 Windows 安装包已签名。

## 4) 日常发布检查清单

1. 确保 `main` 分支在 CI 中通过。
2. 根据需要更新应用版本号。
3. 创建发布标签：`vX.Y.Z`。
4. 推送标签。
5. 验证工作流步骤：
   - preflight 检查通过
   - 所有矩阵构建通过
   - 发布任务上传了预期的文件
6. 对下载的产物进行冒烟测试。

## 5) 故障排除

- macOS 构建未签名但预期应签名：
  - 检查所有 Apple secrets 是否已填写且非空。
- Windows 构建未签名但预期应签名：
  - 检查所有 Azure ATS 和认证 secrets 是否已填写且非空。
- 构建因签名错误失败：
  - 尝试移除 secrets 后重试，确认无签名路径仍可正常工作。
  - 重新检查证书/配置文件名称以及租户/客户端凭据。
