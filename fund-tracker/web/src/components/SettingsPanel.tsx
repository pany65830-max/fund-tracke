import { useState } from "react";
import type { LiveSettings } from "../lib/liveApi";

export function SettingsPanel({
  settings,
  onChange,
  onSave,
  onClear,
  onRefresh,
  onPublish,
  refreshing,
  publishing,
  message,
}: {
  settings: LiveSettings;
  onChange: (s: LiveSettings) => void;
  onSave: () => void;
  onClear: () => void;
  onRefresh: () => void;
  onPublish: () => void;
  refreshing: boolean;
  publishing: boolean;
  message: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [showToken, setShowToken] = useState(false);

  return (
    <div className="settings-wrap">
      <button
        type="button"
        className="gear-btn"
        onClick={() => setOpen((v) => !v)}
        title="数据设置：填 iFinD API 拉最新数据"
      >
        ⚙ 数据
      </button>
      {open ? (
        <div className="settings-panel">
          <div className="settings-title">数据设置</div>

          <label className="settings-field">
            <span>中间人地址（Worker）</span>
            <input
              type="text"
              value={settings.workerUrl}
              placeholder="https://xxx.workers.dev"
              onChange={(e) => onChange({ ...settings, workerUrl: e.target.value })}
            />
          </label>

          <label className="settings-field">
            <span>iFinD token</span>
            <div className="token-row">
              <input
                type={showToken ? "text" : "password"}
                value={settings.token}
                placeholder="粘贴你的 iFinD refresh_token"
                onChange={(e) => onChange({ ...settings, token: e.target.value })}
              />
              <button
                type="button"
                className="mini"
                onClick={() => setShowToken((v) => !v)}
              >
                {showToken ? "隐藏" : "显示"}
              </button>
            </div>
          </label>

          <div className="settings-actions">
            <button type="button" onClick={onSave}>
              保存
            </button>
            <button type="button" className="ghost" onClick={onClear}>
              清除
            </button>
          </div>

          <hr />

          <button
            type="button"
            className="refresh-btn"
            disabled={refreshing}
            onClick={onRefresh}
          >
            {refreshing ? "拉取中…" : "立即刷新（仅本机预览）"}
          </button>

          <button
            type="button"
            className="publish-btn"
            disabled={publishing}
            onClick={onPublish}
            title="拉取 iFinD 数据并写回 GitHub，触发网站重新部署，线上所有人可见"
          >
            {publishing ? "发布中…" : "更新并发布（写线上）"}
          </button>

          {message ? <div className="settings-msg">{message}</div> : null}
          <div className="settings-hint">
            token 只存在你浏览器，并经中间人转发，不进任何代码。
            「更新并发布」会经 Worker 把当日数据写回仓库并重新部署网站。
          </div>
        </div>
      ) : null}
    </div>
  );
}
