# Electron-Entwicklung in Cursor – Erkenntnisse & Fallstricke

Gesammelte Learnings aus der Entwicklung dieses Projekts. Diese Probleme sind nicht offensichtlich und können viel Zeit kosten, wenn man sie nicht kennt.

---

## 1. Electron-in-Cursor Konflikt (`ELECTRON_RUN_AS_NODE`)

### Problem

Cursor ist selbst eine Electron-App und setzt die Umgebungsvariable `ELECTRON_RUN_AS_NODE=1` im integrierten Terminal. Diese Variable bewirkt, dass Electron **nicht als GUI-Anwendung startet**, sondern als reiner Node.js-Prozess läuft. Das Ergebnis: kein Fenster, kein Dialog – die App scheint einfach nichts zu tun.

### Lösung

Im `start`-Script muss die Variable vor dem Start explizit entfernt werden:

```json
{
  "scripts": {
    "start": "unset ELECTRON_RUN_AS_NODE && electron ."
  }
}
```

### Warum das passiert

Cursor nutzt `ELECTRON_RUN_AS_NODE`, damit seine eigenen internen Node-Prozesse korrekt funktionieren. Alle Kind-Prozesse im Terminal erben diese Variable automatisch.

---

## 2. `contextBridge.exposeInMainWorld` Naming-Konflikt (Electron 41+)

### Problem

Ab Electron 41 registriert `contextBridge.exposeInMainWorld('electronAPI', ...)` den übergebenen Namen als **globale Konstante** im Renderer-Scope. Eine erneute Deklaration mit demselben Namen führt zu:

```
Uncaught SyntaxError: Identifier 'electronAPI' has already been declared
```

Dieser Fehler ist **nur in der DevTools-Konsole sichtbar** und blockiert **stillschweigend die gesamte JS-Datei** – kein einziger Event-Listener wird registriert, kein Button funktioniert.

### Lösung

Im Renderer einen **anderen Variablennamen** verwenden:

```javascript
// Richtig
const api = window.electronAPI;

// Falsch – verursacht SyntaxError in Electron 41+
const { electronAPI } = window;
```

### Tipp

Dieses Problem tritt nur in neueren Electron-Versionen auf. Ältere Tutorials und Beispiele verwenden häufig noch die Destructuring-Variante, die dort auch funktioniert.

---

## 3. Debugging-Strategie: "Es passiert gar nichts"

### Problem

Fehler im Renderer-Prozess (z.B. SyntaxError in `app.js`) erscheinen **ausschließlich in der DevTools-Konsole**. Im Terminal, in dem `npm start` läuft, ist davon nichts zu sehen. Die App startet scheinbar normal, aber Buttons und andere UI-Elemente reagieren nicht.

### Lösung

Bei unerklärlichem Verhalten sofort DevTools öffnen. Dafür temporär in `main.js` nach `loadFile` einfügen:

```javascript
mainWindow.webContents.openDevTools({ mode: 'detach' });
```

Dann die Konsole auf rote Fehlermeldungen prüfen. Nach dem Debugging die Zeile wieder entfernen.

### Debugging-Checkliste

1. DevTools öffnen und Console-Tab prüfen
2. `console.log` an den Anfang des Click-Handlers setzen – kommt die Ausgabe?
3. IPC-Handler im Main-Prozess mit `console.log` versehen – diese Ausgaben erscheinen im Terminal
4. Netzwerk-Tab prüfen, ob Dateien (CSS, JS) korrekt geladen werden

---

## Zusammenfassung


| Symptom                                          | Ursache                                              | Lösung                                               |
| ------------------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------- |
| App startet nicht als GUI im Cursor-Terminal     | `ELECTRON_RUN_AS_NODE=1` wird von Cursor gesetzt     | `unset ELECTRON_RUN_AS_NODE` im Start-Script         |
| Buttons reagieren nicht, keine sichtbaren Fehler | SyntaxError durch doppelte `electronAPI`-Deklaration | `const api = window.electronAPI` statt Destructuring |
| Fehler im Renderer nicht auffindbar              | Renderer-Fehler nur in DevTools sichtbar             | `openDevTools()` temporär aktivieren                 |


