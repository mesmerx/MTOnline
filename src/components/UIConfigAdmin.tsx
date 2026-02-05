import { useEffect, useMemo, useState } from 'react';

type TopMenuItem = {
  text: string;
  command?: string;
  submenu?: TopMenuItem[];
};

type EntityActionMap = {
  leftClick?: string[];
  rightClick?: string[];
  doubleClick?: string[];
  click?: string[];
};

type EntityConfig = {
  actions?: EntityActionMap;
};

type UIConfig = {
  ['top menu']?: Record<string, TopMenuItem[]>;
  aliases?: Record<string, string>;
  entities?: Record<string, EntityConfig>;
};

type DragPayload =
  | { type: 'command'; command: string; text: string }
  | { type: 'action'; entity: string; actionKey: keyof EntityActionMap; index: number }
  | { type: 'menu'; scope: string; path: number[] };

const cloneConfig = (config: UIConfig) => JSON.parse(JSON.stringify(config)) as UIConfig;

const getMenuList = (config: UIConfig, scope: string) => {
  const topMenu = (config['top menu'] ??= {});
  const list = topMenu[scope];
  if (!Array.isArray(list)) {
    topMenu[scope] = [];
    return topMenu[scope] as TopMenuItem[];
  }
  return list;
};

const getEntityConfig = (config: UIConfig, entity: string) => {
  config.entities ??= {};
  config.entities[entity] ??= {};
  return config.entities[entity] as EntityConfig;
};

const getActionList = (config: UIConfig, entity: string, key: keyof EntityActionMap) => {
  const entityConfig = getEntityConfig(config, entity);
  entityConfig.actions ??= {};
  const list = entityConfig.actions[key];
  if (!Array.isArray(list)) {
    entityConfig.actions[key] = [];
    return entityConfig.actions[key] as string[];
  }
  return list;
};

const getListByPath = (config: UIConfig, scope: string, parentIndices: number[]) => {
  let list = getMenuList(config, scope);
  for (const index of parentIndices) {
    const item = list[index];
    if (!item) return list;
    item.submenu ??= [];
    list = item.submenu;
  }
  return list;
};

const UIConfigAdmin = () => {
  const [value, setValue] = useState('');
  const [config, setConfig] = useState<UIConfig | null>(null);
  const [mode, setMode] = useState<'visual' | 'json'>('visual');
  const [selectedEntity, setSelectedEntity] = useState('card');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    fetch(`${apiUrl}/config/ui`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data) {
          setError('Failed to load UI config.');
          return;
        }
        setConfig(data);
        setValue(JSON.stringify(data, null, 2));
      })
      .catch(() => {
        setError('Failed to load UI config.');
      })
      .finally(() => setLoading(false));
  }, []);

  const commandPalette = useMemo(() => {
    const aliases = config?.aliases ?? {};
    const commands = Object.keys(aliases);
    if (commands.length > 0) return commands;
    return [
      'tap',
      'flip',
      'changePrint',
      'createCopy',
      'setCommander',
      'sendCommander',
      'remove',
      'draw',
      'shuffle',
      'mulligan',
      'cascadeShow',
      'cascadeFast',
      'moveZone:battlefield',
      'moveZone:hand',
      'moveZone:cemetery',
      'moveZone:exile',
      'moveZone:commander',
      'moveZone:tokens',
      'libraryPlace:top',
      'libraryPlace:random',
      'libraryPlace:bottom',
    ];
  }, [config]);

  const entityOptions = useMemo(() => {
    const fromConfig = config?.entities ? Object.keys(config.entities) : [];
    const base = [
      'card',
      'library',
      'hand',
      'battlefield',
      'cemetery',
      'exile',
      'commander',
      'tokens',
    ];
    const merged = Array.from(new Set([...base, ...fromConfig]));
    return merged.length > 0 ? merged : base;
  }, [config]);

  useEffect(() => {
    if (!entityOptions.includes(selectedEntity)) {
      setSelectedEntity(entityOptions[0] ?? 'card');
    }
  }, [entityOptions, selectedEntity]);

  const updateConfig = (updater: (draft: UIConfig) => UIConfig) => {
    setConfig((prev) => {
      const base = prev ?? {};
      const next = updater(cloneConfig(base));
      setValue(JSON.stringify(next, null, 2));
      return next;
    });
  };

  const handleSave = async () => {
    setError(null);
    setSuccess(null);
    let parsed: UIConfig;
    try {
      parsed = JSON.parse(value);
    } catch (err) {
      setError('Invalid JSON. Please fix syntax errors before saving.');
      return;
    }
    setSaving(true);
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    try {
      const response = await fetch(`${apiUrl}/config/ui`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(parsed),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.error || 'Failed to save UI config.');
        return;
      }
      setConfig(parsed);
      setValue(JSON.stringify(parsed, null, 2));
      setSuccess('UI config saved.');
      window.dispatchEvent(new CustomEvent('ui-config-updated'));
    } catch (err) {
      setError('Failed to save UI config.');
    } finally {
      setSaving(false);
    }
  };

  const handleJsonChange = (nextValue: string) => {
    setValue(nextValue);
    try {
      const parsed = JSON.parse(nextValue);
      setConfig(parsed);
      setError(null);
    } catch {
      setError('Invalid JSON. Please fix syntax errors before saving.');
    }
  };

  const handleDragStart = (event: React.DragEvent, payload: DragPayload) => {
    event.dataTransfer.setData('text/plain', JSON.stringify(payload));
    event.dataTransfer.effectAllowed = 'move';
  };

  const parsePayload = (event: React.DragEvent): DragPayload | null => {
    try {
      const raw = event.dataTransfer.getData('text/plain');
      if (!raw) return null;
      return JSON.parse(raw) as DragPayload;
    } catch {
      return null;
    }
  };

  const insertCommand = (config: UIConfig, scope: string, parent: number[], index: number, command: string, text: string) => {
    const list = getListByPath(config, scope, parent);
    list.splice(index, 0, { text, command });
  };

  const removeItemAt = (config: UIConfig, scope: string, path: number[]) => {
    const parent = path.slice(0, -1);
    const index = path[path.length - 1];
    const list = getListByPath(config, scope, parent);
    if (index < 0 || index >= list.length) return null;
    return list.splice(index, 1)[0] ?? null;
  };

  const insertItemAt = (config: UIConfig, scope: string, parent: number[], index: number, item: TopMenuItem) => {
    const list = getListByPath(config, scope, parent);
    list.splice(index, 0, item);
  };

  const handleDrop = (event: React.DragEvent, scope: string, parent: number[], index: number) => {
    event.preventDefault();
    const payload = parsePayload(event);
    if (!payload) return;
    updateConfig((draft) => {
      if (payload.type === 'command') {
        insertCommand(draft, scope, parent, index, payload.command, payload.text);
        return draft;
      }
      if (payload.type === 'menu') {
        const item = removeItemAt(draft, payload.scope, payload.path);
        if (!item) return draft;
        insertItemAt(draft, scope, parent, index, item);
        return draft;
      }
      return draft;
    });
  };

  const handleActionDrop = (
    event: React.DragEvent,
    entity: string,
    actionKey: keyof EntityActionMap,
    index: number
  ) => {
    event.preventDefault();
    const payload = parsePayload(event);
    if (!payload) return;
    updateConfig((draft) => {
      const list = getActionList(draft, entity, actionKey);
      if (payload.type === 'command') {
        list.splice(index, 0, payload.command);
        return draft;
      }
      if (payload.type === 'action') {
        const sourceList = getActionList(draft, payload.entity, payload.actionKey);
        const [moved] = sourceList.splice(payload.index, 1);
        if (moved) {
          list.splice(index, 0, moved);
        }
        return draft;
      }
      return draft;
    });
  };

  const handleDropToSubmenu = (event: React.DragEvent, scope: string, itemPath: number[]) => {
    event.preventDefault();
    const payload = parsePayload(event);
    if (!payload) return;
    updateConfig((draft) => {
      const list = getListByPath(draft, scope, itemPath);
      if (payload.type === 'command') {
        list.push({ text: payload.text, command: payload.command });
        return draft;
      }
      if (payload.type === 'menu') {
        const item = removeItemAt(draft, payload.scope, payload.path);
        if (!item) return draft;
        list.push(item);
        return draft;
      }
      return draft;
    });
  };

  const renderMenuList = (items: TopMenuItem[], scope: string, parent: number[] = []) => {
    return (
      <div
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => handleDrop(event, scope, parent, items.length)}
        style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}
      >
        {items.map((item, index) => {
          const path = [...parent, index];
          return (
            <div
              key={`${scope}-${path.join('-')}`}
              draggable
              onDragStart={(event) => handleDragStart(event, { type: 'menu', scope, path })}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => handleDrop(event, scope, parent, index)}
              style={{
                border: '1px solid rgba(148, 163, 184, 0.3)',
                borderRadius: '8px',
                padding: '8px',
                background: 'rgba(15, 23, 42, 0.65)',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontWeight: 600 }}>{item.text}</span>
                {item.command && (
                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>{item.command}</span>
                )}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
                  <button
                    type="button"
                    onClick={() => {
                      const nextText = window.prompt('Menu label', item.text);
                      if (!nextText) return;
                      updateConfig((draft) => {
                        const list = getListByPath(draft, scope, parent);
                        if (list[index]) {
                          list[index].text = nextText;
                        }
                        return draft;
                      });
                    }}
                    style={{
                      border: '1px solid rgba(148, 163, 184, 0.3)',
                      background: 'transparent',
                      color: '#f8fafc',
                      borderRadius: '6px',
                      padding: '2px 6px',
                      fontSize: '11px',
                      cursor: 'pointer',
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const nextCommand = window.prompt('Command', item.command ?? '');
                      if (nextCommand === null) return;
                      updateConfig((draft) => {
                        const list = getListByPath(draft, scope, parent);
                        if (list[index]) {
                          list[index].command = nextCommand || undefined;
                        }
                        return draft;
                      });
                    }}
                    style={{
                      border: '1px solid rgba(148, 163, 184, 0.3)',
                      background: 'transparent',
                      color: '#f8fafc',
                      borderRadius: '6px',
                      padding: '2px 6px',
                      fontSize: '11px',
                      cursor: 'pointer',
                    }}
                  >
                    Cmd
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      updateConfig((draft) => {
                        removeItemAt(draft, scope, path);
                        return draft;
                      });
                    }}
                    style={{
                      border: '1px solid rgba(248, 113, 113, 0.5)',
                      background: 'transparent',
                      color: '#f87171',
                      borderRadius: '6px',
                      padding: '2px 6px',
                      fontSize: '11px',
                      cursor: 'pointer',
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => handleDropToSubmenu(event, scope, path)}
                style={{
                  border: '1px dashed rgba(148, 163, 184, 0.4)',
                  borderRadius: '6px',
                  padding: '6px',
                  color: '#94a3b8',
                  fontSize: '11px',
                }}
              >
                Drop here to add submenu item
              </div>
              {item.submenu && item.submenu.length > 0 && (
                <div style={{ marginLeft: '12px' }}>{renderMenuList(item.submenu, scope, path)}</div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderActionList = (entity: string, actionKey: keyof EntityActionMap, label: string) => {
    if (!config) {
      return null;
    }
    const items = getActionList(config, entity, actionKey);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ fontWeight: 600, fontSize: '12px' }}>{label}</div>
        <div
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => handleActionDrop(event, entity, actionKey, items.length)}
          style={{
            border: '1px dashed rgba(148, 163, 184, 0.4)',
            borderRadius: '8px',
            padding: '8px',
            minHeight: '44px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '6px',
          }}
        >
          {items.map((command, index) => (
            <div
              key={`${entity}-${actionKey}-${command}-${index}`}
              draggable
              onDragStart={(event) => handleDragStart(event, { type: 'action', entity, actionKey, index })}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => handleActionDrop(event, entity, actionKey, index)}
              style={{
                padding: '4px 8px',
                borderRadius: '6px',
                border: '1px solid rgba(148, 163, 184, 0.3)',
                background: 'rgba(30, 41, 59, 0.6)',
                fontSize: '11px',
                color: '#f8fafc',
                cursor: 'grab',
              }}
            >
              {command}
            </div>
          ))}
          {items.length === 0 && <div style={{ color: '#94a3b8', fontSize: '11px' }}>Drop commands here</div>}
        </div>
      </div>
    );
  };

  if (loading) {
    return <div style={{ color: '#94a3b8' }}>Loading UI config…</div>;
  }

  if (!config) {
    return <div style={{ color: '#f87171' }}>Failed to load UI config.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          type="button"
          onClick={() => setMode('visual')}
          style={{
            padding: '6px 12px',
            borderRadius: '6px',
            border: '1px solid rgba(148, 163, 184, 0.4)',
            background: mode === 'visual' ? 'rgba(99, 102, 241, 0.8)' : 'transparent',
            color: '#f8fafc',
            cursor: 'pointer',
          }}
        >
          Visual
        </button>
        <button
          type="button"
          onClick={() => setMode('json')}
          style={{
            padding: '6px 12px',
            borderRadius: '6px',
            border: '1px solid rgba(148, 163, 184, 0.4)',
            background: mode === 'json' ? 'rgba(99, 102, 241, 0.8)' : 'transparent',
            color: '#f8fafc',
            cursor: 'pointer',
          }}
        >
          JSON
        </button>
      </div>

      {mode === 'visual' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: '16px' }}>
            <div
              style={{
                border: '1px solid rgba(148, 163, 184, 0.4)',
                borderRadius: '10px',
                padding: '10px',
                background: 'rgba(15, 23, 42, 0.75)',
                maxHeight: '420px',
                overflowY: 'auto',
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: '10px' }}>Commands</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '320px', overflowY: 'auto' }}>
                {commandPalette.map((command) => (
                  <div
                    key={command}
                    draggable
                    onDragStart={(event) =>
                      handleDragStart(event, {
                        type: 'command',
                        command,
                        text: command,
                      })
                    }
                    style={{
                      padding: '6px',
                      borderRadius: '6px',
                      border: '1px solid rgba(148, 163, 184, 0.3)',
                      color: '#f8fafc',
                      fontSize: '11px',
                      cursor: 'grab',
                      background: 'rgba(30, 41, 59, 0.6)',
                    }}
                  >
                    {command}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div
                style={{
                  display: 'flex',
                  gap: '8px',
                  flexWrap: 'wrap',
                  padding: '6px',
                  border: '1px solid rgba(148, 163, 184, 0.25)',
                  borderRadius: '10px',
                  background: 'rgba(15, 23, 42, 0.45)',
                  maxHeight: '120px',
                  overflowY: 'auto',
                }}
              >
                {entityOptions.map((entity) => (
                  <button
                    key={entity}
                    type="button"
                    onClick={() => setSelectedEntity(entity)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: '8px',
                      border: '1px solid rgba(148, 163, 184, 0.4)',
                      background: selectedEntity === entity ? 'rgba(99, 102, 241, 0.8)' : 'transparent',
                      color: '#f8fafc',
                      cursor: 'pointer',
                      fontSize: '12px',
                    }}
                  >
                    {entity}
                  </button>
                ))}
              </div>

              <div
                style={{
                  border: '1px solid rgba(148, 163, 184, 0.3)',
                  borderRadius: '12px',
                  padding: '12px',
                  background: 'rgba(15, 23, 42, 0.55)',
                  maxHeight: '600px',
                  overflowY: 'auto',
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: '12px' }}>{selectedEntity}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  {renderActionList(selectedEntity, 'click', 'On click')}
                  {renderActionList(selectedEntity, 'doubleClick', 'On double click')}
                  {renderActionList(selectedEntity, 'rightClick', 'On right click')}
                  {renderActionList(selectedEntity, 'leftClick', 'On left click')}
                </div>
                <div style={{ marginTop: '14px' }}>
                  <div style={{ fontWeight: 600, marginBottom: '8px' }}>Menu</div>
                  {renderMenuList(getMenuList(config, selectedEntity), selectedEntity)}
                </div>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: '1px solid rgba(148, 163, 184, 0.4)',
                background: saving ? 'rgba(148, 163, 184, 0.2)' : 'rgba(99, 102, 241, 0.8)',
                color: '#f8fafc',
                cursor: saving ? 'not-allowed' : 'pointer',
                fontWeight: 600,
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {mode === 'json' && (
        <>
          <textarea
            value={value}
            onChange={(event) => handleJsonChange(event.target.value)}
            style={{
              minHeight: '360px',
              padding: '12px',
              borderRadius: '8px',
              border: '1px solid rgba(148, 163, 184, 0.4)',
              background: 'rgba(15, 23, 42, 0.75)',
              color: '#f8fafc',
              fontFamily: 'monospace',
              fontSize: '12px',
              resize: 'vertical',
            }}
            spellCheck={false}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: '1px solid rgba(148, 163, 184, 0.4)',
                background: saving ? 'rgba(148, 163, 184, 0.2)' : 'rgba(99, 102, 241, 0.8)',
                color: '#f8fafc',
                cursor: saving ? 'not-allowed' : 'pointer',
                fontWeight: 600,
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </>
      )}

      {error && <div style={{ color: '#f87171', fontSize: '12px' }}>{error}</div>}
      {success && <div style={{ color: '#22c55e', fontSize: '12px' }}>{success}</div>}
    </div>
  );
};

export default UIConfigAdmin;

