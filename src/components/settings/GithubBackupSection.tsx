import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { settingsApi } from "@/lib/api";
import type { GitHubBackupSettings } from "@/types";

interface GithubBackupSectionProps {
  config?: GitHubBackupSettings;
}

/**
 * GitHub 备份设置：本地 git 仓目录 + 远程仓库 URL + 分支 + PAT。
 * token 脱密返回（后端总是清空），保存时空 token 表示沿用旧值。
 */
export function GithubBackupSection({ config }: GithubBackupSectionProps) {
  const { t } = useTranslation();

  const [enabled, setEnabled] = useState(false);
  const [localDir, setLocalDir] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [token, setToken] = useState("");
  const [tokenTouched, setTokenTouched] = useState(false);
  const [hasSavedToken, setHasSavedToken] = useState(false);
  const [saving, setSaving] = useState(false);

  // 从后端配置初始化（token 永远是空的，用 status 是否存在间接判断曾保存过）
  useEffect(() => {
    setEnabled(config?.enabled ?? false);
    setLocalDir(config?.localDir ?? "");
    setRemoteUrl(config?.remoteUrl ?? "");
    setBranch(config?.branch ?? "main");
    setToken("");
    setTokenTouched(false);
    // 后端已配置（有 remoteUrl）且 token 被脱密清空 → 视为已存在 token
    setHasSavedToken(Boolean(config?.remoteUrl));
  }, [config]);

  const handleBrowseDir = useCallback(async () => {
    try {
      const picked = await settingsApi.selectConfigDirectory(
        localDir || undefined,
      );
      if (picked) setLocalDir(picked);
    } catch (error) {
      console.error("[GithubBackupSection] pick dir failed", error);
      toast.error(
        t("settings.selectFileFailed", { defaultValue: "选择目录失败" }),
      );
    }
  }, [localDir, t]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await settingsApi.githubBackupSaveSettings(
        {
          enabled,
          localDir: localDir.trim(),
          remoteUrl: remoteUrl.trim(),
          branch: branch.trim() || "main",
          token,
        },
        tokenTouched,
      );
      setToken("");
      setTokenTouched(false);
      setHasSavedToken(true);
      toast.success(
        t("settings.githubBackup.saved", { defaultValue: "已保存" }),
      );
    } catch (error) {
      toast.error(t("common.error"), { description: String(error) });
    } finally {
      setSaving(false);
    }
  }, [enabled, localDir, remoteUrl, branch, token, tokenTouched, t]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium">
            {t("settings.githubBackup.enable", {
              defaultValue: "启用 GitHub 备份",
            })}
          </Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("settings.githubBackup.enableHint", {
              defaultValue: "把 skill 备份到你自己的 GitHub 仓库",
            })}
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>

      <div className="space-y-1.5">
        <Label className="text-sm">
          {t("settings.githubBackup.localDir", {
            defaultValue: "本地仓库目录",
          })}
        </Label>
        <div className="flex gap-2">
          <Input
            value={localDir}
            onChange={(e) => setLocalDir(e.target.value)}
            placeholder="/path/to/local/repo"
          />
          <Button type="button" variant="outline" onClick={handleBrowseDir}>
            {t("settings.githubBackup.browse", { defaultValue: "选择目录" })}
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-sm">
          {t("settings.githubBackup.remoteUrl", {
            defaultValue: "远程仓库 URL",
          })}
        </Label>
        <Input
          value={remoteUrl}
          onChange={(e) => setRemoteUrl(e.target.value)}
          placeholder="https://github.com/owner/repo.git"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-sm">
          {t("settings.githubBackup.branch", { defaultValue: "分支" })}
        </Label>
        <Input
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder="main"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-sm">
          {t("settings.githubBackup.token", {
            defaultValue: "GitHub Token (PAT)",
          })}
        </Label>
        <Input
          type="password"
          value={token}
          onChange={(e) => {
            setToken(e.target.value);
            setTokenTouched(true);
          }}
          placeholder={
            hasSavedToken
              ? t("settings.githubBackup.tokenSaved", {
                  defaultValue: "（已保存，留空则沿用）",
                })
              : "ghp_..."
          }
        />
        <p className="text-xs text-muted-foreground">
          {t("settings.githubBackup.tokenHint", {
            defaultValue: "Token 会拼进远程 URL 用于推送，仅存于本地。",
          })}
        </p>
      </div>

      <div className="flex justify-end">
        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving
            ? t("common.saving", { defaultValue: "保存中..." })
            : t("common.save", { defaultValue: "保存" })}
        </Button>
      </div>
    </div>
  );
}
