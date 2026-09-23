// 全局设置上下文：加载 IndexedDB（或默认），setShowHighlight 同步持久化
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AppSettings } from './types';
import { defaultSettings } from './lib/factory';
import { loadSettings, saveSettings } from './lib/storage';

interface Ctx {
  s: AppSettings;
  setShowHighlight: (v: boolean) => void;
  setStretch: (v: number) => void;
  replaceSettings: (s: AppSettings) => void;
}

const SettingsCtx = createContext<Ctx>({
  s: defaultSettings(),
  setShowHighlight: () => {},
  setStretch: () => {},
  replaceSettings: () => {},
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<AppSettings>(defaultSettings());
  useEffect(() => {
    loadSettings().then((loaded) => {
      if (loaded) setS({ ...defaultSettings(), ...loaded });
    });
  }, []);
  const persist = (next: AppSettings) => {
    setS(next);
    void saveSettings(next);
  };
  return (
    <SettingsCtx.Provider
      value={{
        s,
        setShowHighlight: (v) => persist({ ...s, showHighlight: v }),
        setStretch: (v) => persist({ ...s, currentBeatStretch: v }),
        replaceSettings: (next) => persist(next),
      }}
    >
      {children}
    </SettingsCtx.Provider>
  );
}

export function useSettings(): Ctx {
  return useContext(SettingsCtx);
}
