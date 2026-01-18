# Configuração do Systemd para MTOnline

## Instalação

1. Copie o arquivo de serviço para o diretório systemd:
```bash
sudo cp /home/mesmer/mtonline/mtonline.service /etc/systemd/system/
```

2. Recarregue o systemd para reconhecer o novo serviço:
```bash
sudo systemctl daemon-reload
```

3. Habilite o serviço para iniciar automaticamente no boot:
```bash
sudo systemctl enable mtonline.service
```

4. Inicie o serviço:
```bash
sudo systemctl start mtonline.service
```

## Comandos Úteis

### Verificar status do serviço:
```bash
sudo systemctl status mtonline.service
```

### Ver logs do serviço:
```bash
sudo journalctl -u mtonline.service -f
```

### Parar o serviço:
```bash
sudo systemctl stop mtonline.service
```

### Reiniciar o serviço:
```bash
sudo systemctl restart mtonline.service
```

### Desabilitar o serviço (não iniciar no boot):
```bash
sudo systemctl disable mtonline.service
```

### Desinstalar o serviço:
```bash
sudo systemctl stop mtonline.service
sudo systemctl disable mtonline.service
sudo rm /etc/systemd/system/mtonline.service
sudo systemctl daemon-reload
```

## Notas

- O serviço está configurado para reiniciar automaticamente se falhar (Restart=always)
- Os logs são salvos no journalctl do systemd
- O serviço usa o usuário `mesmer` e o PATH inclui o nvm
- O WorkingDirectory está configurado para `/home/mesmer/mtonline`


