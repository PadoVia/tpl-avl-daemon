# tpl-avl-daemon

**tpl-avl-daemon** è un demone scritto in Node.js per il monitoraggio in tempo reale dei mezzi del Trasporto Pubblico Locale (TPL) attraverso sorgenti **AVL** (Automatic Vehicle Location) e **GTFS-RT** (General Transit Feed Specification – Realtime).  
Progettato per essere semplice, estendibile e facilmente integrabile in sistemi di tracciamento o dashboard di mobilità urbana.

---

## 🚀 Funzionalità principali

- Login automatico ai servizi AVL remoti
- Raccolta dati posizione/velocità/porta dei veicoli
- Calcolo bearing tra posizioni successive
- Gestione retry e polling configurabile
- Supporto multi-operatore
- Integrazione con Redis
- Timestamp unificati (ISO 8601 UTC)
- Modularità per ogni operatore (es. `busitalia_veneto_padua.js`)

---

## 📦 Requisiti

- Node.js v18+  
- Redis server attivo (per salvataggio/stato opzionale)

---

## 🛠️ Installazione

```bash
git clone https://github.com/PadoVia/tpl-avl-daemon.git
cd tpl-avl-daemon
npm install
```

---

## ⚙️ Configurazione

1. Copia il file di esempio:

```bash
cp config.example.json config.json
```

2. Personalizza `config.json`:

- Inserisci le credenziali di accesso API
- Verifica gli endpoint
- Abilita/disabilita operatori o componenti AVL/GTFS

---

## 🧪 Avvio

### Esecuzione standard:

```bash
npm start
```

### Modalità sviluppo (con reload):

```bash
npm run dev
```

---

## 📁 Struttura del progetto

```
tpl-avl-daemon/
├── node_modules/
├── operators/
│   └── busitalia_veneto_padua.js      # Operatore specifico
├── .gitattributes
├── .gitignore
├── config.example.json                 # Configurazione di esempio
├── config.json                         # Configurazione runtime (esclusa da Git)
├── index.js                            # Entry point principale
├── LICENSE                             # Licenza (ISC)
├── package.json
├── package-lock.json
├── redisClient.js                      # Connessione a Redis
├── tokenManager.js                     # Gestione token JWT o simili
├── tools.js                            # Moduli di supporto
├── utils.js                            # Funzioni utilitarie (es. bearing, timestamp)
```

---

## 📄 Esempio config.json

```json
{
  "default_polling_interval": 1,
  "default_timeout": 30,
  "redis_url": "redis://user:password@host:port",
  "operators": [
    {
      "name": "Busitalia Veneto",
      "slug": "busitalia_veneto_padua",
      "enable": true,
      "filename": "busitalia_veneto_padua.js",
      "avl": {
        "enable": true,
        "login": { "url": "...", "username": "...", "password": "..." },
        "vehicles": { "url": "..." }
      }
    }
  ]
}
```

---

## 🧠 Estendere un operatore

Per aggiungere un nuovo operatore:

1. Crea un file in `operators/` (es. `azienda_xyz.js`)
2. Implementa le funzioni `login` e `fetchVehicles`
3. Aggiungilo in `config.json` con `"enable": true`

---

## 🪪 Licenza

Questo progetto è rilasciato sotto licenza **ISC**.  
Vedi [LICENSE](./LICENSE) per dettagli.
