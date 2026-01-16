import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useGameStore } from '../store/useGameStore';

const ConnectionSettings = () => {
  const turnConfig = useGameStore((state) => state.turnConfig);
  const setTurnMode = useGameStore((state) => state.setTurnMode);
  const updateTurnCredentials = useGameStore((state) => state.updateTurnCredentials);
  const resetTurnConfig = useGameStore((state) => state.resetTurnConfig);
  const [localConfig, setLocalConfig] = useState(turnConfig);

  useEffect(() => {
    setLocalConfig(turnConfig);
  }, [turnConfig]);

  const usingCustom = localConfig.mode === 'custom';

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (usingCustom && (!localConfig.url || !localConfig.username || !localConfig.credential)) {
      return;
    }
    setTurnMode(localConfig.mode);
    updateTurnCredentials({
      url: localConfig.url,
      username: localConfig.username,
      credential: localConfig.credential,
    });
  };

  const toggleCustom = () => {
    const nextMode = usingCustom ? 'env' : 'custom';
    setLocalConfig((prev) => ({ ...prev, mode: nextMode }));
    if (nextMode === 'env') {
      setTurnMode('env');
    }
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Connection</h2>
      </div>
      <form className="connection-form" onSubmit={handleSubmit}>
        <label className="checkbox-field">
          <input type="checkbox" checked={usingCustom} onChange={toggleCustom} />
          <span>Use custom TURN relay</span>
        </label>

        {usingCustom ? (
          <>
            <label className="field">
              <span>TURN URL</span>
              <input
                type="text"
                value={localConfig.url}
                onChange={(event) => setLocalConfig((prev) => ({ ...prev, url: event.target.value }))}
                placeholder="turns:host:3478"
                required
              />
            </label>
            <label className="field">
              <span>Username</span>
              <input
                type="text"
                value={localConfig.username}
                onChange={(event) => setLocalConfig((prev) => ({ ...prev, username: event.target.value }))}
                required
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                type="text"
                value={localConfig.credential}
                onChange={(event) => setLocalConfig((prev) => ({ ...prev, credential: event.target.value }))}
                required
              />
            </label>

            <div className="button-row">
              <button className="primary" type="submit">
                Apply
              </button>
              <button type="button" className="ghost" onClick={resetTurnConfig}>
                Revert to env/default
              </button>
            </div>
          </>
        ) : (
          <p className="muted">
            Using default ICE servers from <code>.env</code>. Point them at your coturn instance (or add one via the form)
            to mirror Foundry&apos;s behavior.
          </p>
        )}
      </form>
    </div>
  );
};

export default ConnectionSettings;
