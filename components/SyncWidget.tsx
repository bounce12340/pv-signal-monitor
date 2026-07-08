import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  getSyncMeta, fetchServerMeta, localDataHash, localIsEmpty,
  pushToCloud, pullFromCloud, ServerMeta,
} from '../services/sync';
import { Cloud, CloudOff, CloudDownload, CloudUpload, Loader2, AlertTriangle } from 'lucide-react';

type SyncState = 'offline' | 'synced' | 'syncing' | 'cloud-newer' | 'conflict' | 'error';

interface SyncWidgetProps {
  // Bumped by App when DB contents change; also refreshed on an interval.
  refreshKey: number | string;
  onPulled: () => void;
}

export const SyncWidget = ({ refreshKey, onPulled }: SyncWidgetProps) => {
  const [state, setState] = useState<SyncState>('offline');
  const [server, setServer] = useState<ServerMeta | null>(null);
  const [open, setOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const busyRef = useRef(false);

  const refresh = useCallback(async (allowAutoPush: boolean) => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const serverMeta = await fetchServerMeta();
      setServer(serverMeta);
      if (!serverMeta) {
        setState('offline');
        return;
      }

      const meta = getSyncMeta();
      const hash = await localDataHash();
      const dirty = hash !== meta.last_hash;
      const cloudNewer =
        !!serverMeta.updated_at && serverMeta.updated_at !== meta.server_updated_at;

      if (cloudNewer && dirty && !localIsEmpty()) {
        setState('conflict');
      } else if (cloudNewer) {
        // Includes the fresh-browser case (empty local data): never
        // auto-push emptiness over real cloud data.
        setState('cloud-newer');
      } else if (dirty) {
        if (allowAutoPush) {
          setState('syncing');
          await pushToCloud();
          setState('synced');
        } else {
          setState('syncing');
        }
      } else {
        setState('synced');
      }
      setErrorMsg(null);
    } catch (e) {
      setState('error');
      setErrorMsg(e instanceof Error ? e.message : '同步失敗');
    } finally {
      busyRef.current = false;
    }
  }, []);

  useEffect(() => {
    refresh(true);
    const timer = setInterval(() => refresh(true), 60_000);
    const onFocus = () => refresh(true);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh, refreshKey]);

  const handlePull = async () => {
    const when = server?.updated_at ? new Date(server.updated_at).toLocaleString() : '';
    if (!window.confirm(
      `將以雲端資料（來自 ${server?.device || '未知裝置'}，${when}）覆蓋本機所有資料。\n本機未同步的變更會遺失。確定要下載？`
    )) return;
    try {
      setState('syncing');
      await pullFromCloud();
      onPulled();
      setOpen(false);
      await refresh(false);
      setState('synced');
    } catch (e) {
      setState('error');
      setErrorMsg(e instanceof Error ? e.message : '下載失敗');
    }
  };

  const handleForcePush = async () => {
    if (!window.confirm('將以本機資料覆蓋雲端最新快照（雲端保留歷史版本）。確定要上傳？')) return;
    try {
      setState('syncing');
      await pushToCloud();
      setOpen(false);
      await refresh(false);
      setState('synced');
    } catch (e) {
      setState('error');
      setErrorMsg(e instanceof Error ? e.message : '上傳失敗');
    }
  };

  const chip = {
    offline:      { icon: <CloudOff size={14} />, text: '單機', cls: 'text-slate-500' },
    synced:       { icon: <Cloud size={14} />, text: '已同步', cls: 'text-green-400' },
    syncing:      { icon: <Loader2 size={14} className="animate-spin" />, text: '同步中', cls: 'text-brand-300' },
    'cloud-newer':{ icon: <CloudDownload size={14} />, text: '雲端較新', cls: 'text-amber-300' },
    conflict:     { icon: <AlertTriangle size={14} />, text: '同步衝突', cls: 'text-red-400' },
    error:        { icon: <AlertTriangle size={14} />, text: '同步錯誤', cls: 'text-red-400' },
  }[state];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`px-2.5 py-2 text-xs font-medium rounded-md transition-all flex items-center gap-1.5 hover:bg-slate-700/50 ${chip.cls}`}
        title="跨裝置同步狀態（資料存於 Cloudflare D1，僅您的帳號可存取）"
      >
        {chip.icon}
        <span className="hidden md:inline">{chip.text}</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 bg-white rounded-lg shadow-xl border border-slate-200 p-4 z-50 text-slate-700 space-y-3">
          <h4 className="font-bold text-sm">跨裝置同步</h4>
          {state === 'offline' && (
            <p className="text-xs text-slate-500">
              目前無法連到同步 API（本機開發模式或網路問題）。資料僅存於此瀏覽器。
            </p>
          )}
          {state === 'synced' && (
            <p className="text-xs text-slate-500">
              本機與雲端一致。
              {server?.updated_at && (
                <> 最近快照：{new Date(server.updated_at).toLocaleString()}（{server.device}）</>
              )}
            </p>
          )}
          {state === 'cloud-newer' && (
            <>
              <p className="text-xs text-slate-600">
                雲端有較新的資料快照（來自 {server?.device || '未知裝置'}，
                {server?.updated_at ? new Date(server.updated_at).toLocaleString() : ''}）。
              </p>
              <button onClick={handlePull} className="w-full py-1.5 text-xs font-medium rounded bg-brand-600 text-white hover:bg-brand-700 flex items-center justify-center gap-1">
                <CloudDownload size={13} /> 下載雲端資料（覆蓋本機）
              </button>
            </>
          )}
          {state === 'conflict' && (
            <>
              <p className="text-xs text-red-600">
                本機與雲端各自都有變更。請選擇保留哪一份（雲端會保留最近 20 份歷史快照）。
              </p>
              <button onClick={handlePull} className="w-full py-1.5 text-xs font-medium rounded bg-slate-100 hover:bg-slate-200 flex items-center justify-center gap-1">
                <CloudDownload size={13} /> 以雲端為準（覆蓋本機）
              </button>
              <button onClick={handleForcePush} className="w-full py-1.5 text-xs font-medium rounded bg-slate-100 hover:bg-slate-200 flex items-center justify-center gap-1">
                <CloudUpload size={13} /> 以本機為準（上傳覆蓋）
              </button>
            </>
          )}
          {state === 'error' && (
            <p className="text-xs text-red-600">{errorMsg}</p>
          )}
          {state !== 'offline' && (
            <p className="text-[10px] text-slate-400">
              本機有變更時會自動上傳；雲端較新時需手動確認下載。
            </p>
          )}
        </div>
      )}
    </div>
  );
};
