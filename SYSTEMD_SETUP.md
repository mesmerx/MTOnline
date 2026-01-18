# Configuração do Systemd para MTOnline

## Pré-requisitos

Antes de configurar o serviço systemd, certifique-se de que todas as dependências estão instaladas:

### 1. Instalar SQLite3

O projeto usa `better-sqlite3`, que requer SQLite3 instalado no sistema:

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install -y sqlite3 libsqlite3-dev build-essential python3
```

**Arch Linux:**
```bash
sudo pacman -S sqlite
```

**Fedora/RHEL:**
```bash
sudo dnf install sqlite sqlite-devel gcc-c++ make python3
```

### 2. Instalar Node.js (via NVM)

O projeto requer Node.js. Recomenda-se usar NVM:

```bash
# Instalar NVM
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Recarregar o shell
source ~/.bashrc  # ou ~/.zshrc

# Instalar Node.js (versão usada no serviço)
nvm install 20.19.0
nvm use 20.19.0
nvm alias default 20.19.0
```

### 3. Instalar pnpm

```bash
npm install -g pnpm
```

### 4. Instalar Dependências do Projeto

No diretório do projeto:

```bash
cd /home/mesmer/mtonline
pnpm install
```

**Nota:** A instalação do `better-sqlite3` pode falhar se SQLite3 não estiver instalado. Se isso acontecer, instale SQLite3 primeiro e depois execute `pnpm install` novamente.

### 5. Criar Diretório de Dados

O banco de dados SQLite será criado automaticamente, mas você pode criar o diretório antecipadamente:

```bash
mkdir -p /home/mesmer/mtonline/data
chmod 755 /home/mesmer/mtonline/data
```

### 6. Configurar Variáveis de Ambiente (Opcional)

Se necessário, crie um arquivo `.env` no diretório do projeto:

```bash
cd /home/mesmer/mtonline
touch .env
```

Exemplo de `.env`:
```
API_PORT=3000
VITE_CLIENT_HOST=localhost
VITE_CLIENT_PORT=5173
```

## Instalação do Serviço Systemd

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


