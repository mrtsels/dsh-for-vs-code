# http-bridge.md — dsh web wire contract(探测记录)

> 生成于 2026-08-15T02:35:10.023Z,dsh unknown,base http://127.0.0.1:3080。升级 dsh 后必须重跑 `node scripts/probe.mjs --write-doc` 回归(R1)。

```json
{
  "base": "http://127.0.0.1:3080",
  "dsh": "unknown",
  "at": "2026-08-15T02:35:10.023Z",
  "spa": {
    "status": 200
  },
  "getMuxStatus": 426,
  "trustFenceBadHost": "HTTP/1.1 403 Forbidden",
  "hostDescribe": {
    "result": {
      "ok": true,
      "value": {
        "version": "0.0.1",
        "cwd": "/Users/minimx/dsh-for-vs-code",
        "provider": "deepseek-official",
        "model": "deepseek-v4-flash",
        "attachedSessions": 8,
        "canOpenPath": true
      }
    }
  },
  "sessionList": {
    "type": "server-response",
    "rpcId": "9fdcc76b-c37b-4f38-8c45-7ad8018afbc4",
    "result": {
      "ok": true,
      "value": {
        "items": [
          {
            "sessionId": "session-43e1dfd9-28cd-4c50-8034-9846c459e9bb",
            "updatedAt": 1786761257739,
            "running": false,
            "blank": true,
            "cwd": "/Users/minimx/dsh-for-vs-code",
            "agentPreset": "standard",
            "title": null
          },
          {
            "sessionId": "session-2c4cfef5-d0f4-484a-a543-3cd858585492",
            "updatedAt": 1786761237432,
            "running": false,
            "blank": true,
            "cwd": "/Users/minimx/dsh-for-vs-code",
            "agentPreset": "standard",
            "title": null
          },
          {
            "sessionId": "session-fb56bb2f-b5b9-4dc3-93e7-0a880b38e6f9",
            "updatedAt": 1786761233314,
            "running": false,
            "blank": true,
            "cwd": "/Users/minimx/dsh-for-vs-code",
            "agentPreset": "standard",
            "title": null
          },
          {
            "sessionId": "session-c99d8a2e-ed53-4739-a25b-3ca980ec4862",
            "updatedAt": 1786761228061,
            "running": false,
            "blank": true,
            "cwd": "/Users/minimx/dsh-for-vs-code",
            "agentPreset": "standard",
            "title": null
          },
          {
            "sessionId": "session-91858a0e-a104-4a4a-94ce-738cb424eacc",
            "updatedAt": 1786760710365,
            "running": false,
            "blank": false,
            "cwd": "/Users/minimx/dsh-for-vs-code",
            "agentPreset": "standard",
            "title": "Hello"
          },
          {
            "sessionId": "session-37408e38-d711-4a6b-b852-148eadace262",
            "updatedAt": 1786760686157,
            "running": false,
            "blank": false,
            "cwd": "/Users/minimx/dsh-for-vs-code",
            "agentPreset": "standard",
            "title": "hi"
          },
          {
            "sessionId": "session-c45fa8fd-7270-49da-96b4-c39c07ee77aa",
            "updatedAt": 1786759100638,
            "running": false,
            "blank": false,
            "cwd": "/Users/minimx/dsh-for-vs-code",
            "agentPreset": "code",
            "title": "See what we will do"
          },
          {
            "sessionId": "session-d6544838-cd03-4f68-b42f-d72ba203917a",
            "updatedAt": 1786663358965,
            "running": false,
            "blank": true,
            "cwd": "/Users/minimx/Documents/resumes",
            "agentPreset": "standard",
            "title": null
          }
        ]
      }
    }
  },
  "agentPresets": "not found",
  "settingsNamespaces": "not found",
  "muxBaseline": [
    {
      "method": "session/subscribed",
      "payloadType": "session/subscribed"
    },
    {
      "method": "session/subscribed",
      "payloadType": "session/subscribed"
    },
    {
      "method": "session/subscribed",
      "payloadType": "session/subscribed"
    },
    {
      "method": "session/subscribed",
      "payloadType": "session/subscribed"
    },
    {
      "method": "session/subscribed",
      "payloadType": "session/subscribed"
    },
    {
      "method": "session/subscribed",
      "payloadType": "session/subscribed"
    },
    {
      "method": "session/subscribed",
      "payloadType": "session/subscribed"
    },
    {
      "method": "session/subscribed",
      "payloadType": "session/subscribed"
    }
  ],
  "hostBaseline": [],
  "createdSession": {
    "type": "server-response",
    "rpcId": "1b227048-fff4-44d8-b736-46c82dd8f055",
    "result": {
      "ok": true,
      "value": {
        "sessionId": "session-6c10a07f-a5df-49da-8437-54c29d33f254",
        "agentPreset": "standard"
      }
    }
  },
  "promptAccepted": {
    "type": "server-response",
    "rpcId": "a0724ef5-481c-4062-9ba4-d26fc3d9cf2c",
    "result": {
      "ok": true,
      "value": {
        "accepted": true
      }
    }
  },
  "goldenTimeline": [
    {
      "type": "agent/inbox/spliced",
      "seq": 3
    },
    {
      "type": "turn/start",
      "seq": 4
    },
    {
      "type": "agent/inbox/spliced",
      "seq": 5
    },
    {
      "type": "step/start",
      "seq": 6
    },
    {
      "type": "user/message",
      "seq": 7,
      "contentLen": 29
    },
    {
      "type": "user/message",
      "seq": 8,
      "contentLen": 3220
    },
    {
      "type": "user/message",
      "seq": 9,
      "contentLen": 503
    },
    {
      "type": "user/message",
      "seq": 10,
      "contentLen": 1237
    },
    {
      "type": "session/title",
      "seq": 11
    },
    {
      "type": "request/header",
      "seq": 12
    },
    {
      "type": "request/context",
      "seq": 13
    },
    {
      "type": "session/title-llm-request",
      "seq": 14
    },
    {
      "type": "session/title",
      "seq": 15
    },
    {
      "type": "assistant/chunk",
      "seq": 16,
      "chunk": {
        "type": "block-start",
        "blockType": "reasoning",
        "textLen": 0
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 17,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 3
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 18,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 5
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 19,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 5
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 20,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 5
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 21,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 2
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 22,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 2
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 23,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 2
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 24,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 5
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 25,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 3
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 26,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 2
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 27,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 7
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 28,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 9
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 29,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 1
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 30,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 2
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 31,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 7
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 32,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 8
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 33,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 9
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 34,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 4
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 35,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 8
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 36,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 1
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 37,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 8
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 38,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 7
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 39,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 5
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 40,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 5
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 41,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 2
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 42,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 5
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 43,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 3
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 44,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 3
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 45,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 1
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 46,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 3
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 47,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 5
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 48,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 4
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 49,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 6
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 50,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 1
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 51,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 6
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 52,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 1
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 53,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 3
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 54,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 9
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 55,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 8
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 56,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 1
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 57,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 5
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 58,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 3
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 59,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 6
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 60,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 4
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 61,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 9
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 62,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 1
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 63,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 6
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 64,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 8
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 65,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 4
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 66,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 8
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 67,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 8
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 68,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 8
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 69,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 2
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 70,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 1
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 71,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 2
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 72,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 4
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 73,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 2
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 74,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 1
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 75,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 5
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 76,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 1
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 77,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 3
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 78,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 5
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 79,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 5
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 80,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 5
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 81,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 3
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 82,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 5
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 83,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 3
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 84,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 3
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 85,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 1
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 86,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 4
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 87,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 4
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 88,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 2
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 89,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 5
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 90,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 2
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 91,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 3
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 92,
      "chunk": {
        "type": "reasoning-delta",
        "textLen": 1
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 93,
      "chunk": {
        "type": "block-start",
        "blockType": "text",
        "textLen": 0
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 94,
      "chunk": {
        "type": "text-delta",
        "textLen": 2
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 95,
      "chunk": {
        "type": "text-delta",
        "textLen": 1
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 96,
      "chunk": {
        "type": "text-delta",
        "textLen": 3
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 97,
      "chunk": {
        "type": "text-delta",
        "textLen": 2
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 98,
      "chunk": {
        "type": "text-delta",
        "textLen": 1
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 99,
      "chunk": {
        "type": "text-delta",
        "textLen": 4
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 100,
      "chunk": {
        "type": "text-delta",
        "textLen": 3
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 101,
      "chunk": {
        "type": "text-delta",
        "textLen": 3
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 102,
      "chunk": {
        "type": "text-delta",
        "textLen": 3
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 103,
      "chunk": {
        "type": "text-delta",
        "textLen": 4
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 104,
      "chunk": {
        "type": "text-delta",
        "textLen": 2
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 105,
      "chunk": {
        "type": "text-delta",
        "textLen": 1
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 106,
      "chunk": {
        "type": "text-delta",
        "textLen": 2
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 107,
      "chunk": {
        "type": "text-delta",
        "textLen": 4
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 108,
      "chunk": {
        "type": "text-delta",
        "textLen": 2
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 109,
      "chunk": {
        "type": "text-delta",
        "textLen": 1
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 110,
      "chunk": {
        "type": "text-delta",
        "textLen": 5
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 111,
      "chunk": {
        "type": "text-delta",
        "textLen": 1
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 112,
      "chunk": {
        "type": "text-delta",
        "textLen": 10
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 113,
      "chunk": {
        "type": "text-delta",
        "textLen": 2
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 114,
      "chunk": {
        "type": "text-delta",
        "textLen": 4
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 115,
      "chunk": {
        "type": "text-delta",
        "textLen": 3
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 116,
      "chunk": {
        "type": "text-delta",
        "textLen": 5
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 117,
      "chunk": {
        "type": "text-delta",
        "textLen": 7
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 118,
      "chunk": {
        "type": "text-delta",
        "textLen": 4
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 119,
      "chunk": {
        "type": "text-delta",
        "textLen": 4
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 120,
      "chunk": {
        "type": "text-delta",
        "textLen": 5
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 121,
      "chunk": {
        "type": "text-delta",
        "textLen": 2
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 122,
      "chunk": {
        "type": "text-delta",
        "textLen": 2
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 123,
      "chunk": {
        "type": "text-delta",
        "textLen": 4
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 124,
      "chunk": {
        "type": "text-delta",
        "textLen": 4
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 125,
      "chunk": {
        "type": "text-delta",
        "textLen": 1
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 126,
      "chunk": {
        "type": "text-delta",
        "textLen": 5
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 127,
      "chunk": {
        "type": "text-delta",
        "textLen": 6
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 128,
      "chunk": {
        "type": "text-delta",
        "textLen": 4
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 129,
      "chunk": {
        "type": "text-delta",
        "textLen": 5
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 130,
      "chunk": {
        "type": "text-delta",
        "textLen": 3
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 131,
      "chunk": {
        "type": "text-delta",
        "textLen": 5
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 132,
      "chunk": {
        "type": "text-delta",
        "textLen": 3
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 133,
      "chunk": {
        "type": "text-delta",
        "textLen": 1
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 134,
      "chunk": {
        "type": "text-delta",
        "textLen": 4
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 135,
      "chunk": {
        "type": "text-delta",
        "textLen": 8
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 136,
      "chunk": {
        "type": "text-delta",
        "textLen": 3
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 137,
      "chunk": {
        "type": "text-delta",
        "textLen": 1
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 138,
      "chunk": {
        "type": "text-delta",
        "textLen": 9
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 139,
      "chunk": {
        "type": "text-delta",
        "textLen": 12
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 140,
      "chunk": {
        "type": "text-delta",
        "textLen": 8
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 141,
      "chunk": {
        "type": "text-delta",
        "textLen": 4
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 142,
      "chunk": {
        "type": "text-delta",
        "textLen": 7
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 143,
      "chunk": {
        "type": "text-delta",
        "textLen": 3
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 144,
      "chunk": {
        "type": "text-delta",
        "textLen": 2
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 145,
      "chunk": {
        "type": "text-delta",
        "textLen": 1
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 146,
      "chunk": {
        "type": "text-delta",
        "textLen": 3
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 147,
      "chunk": {
        "type": "text-delta",
        "textLen": 3
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 148,
      "chunk": {
        "type": "text-delta",
        "textLen": 2
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 149,
      "chunk": {
        "type": "text-delta",
        "textLen": 1
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 150,
      "chunk": {
        "type": "text-delta",
        "textLen": 2
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 151,
      "chunk": {
        "type": "text-delta",
        "textLen": 9
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 152,
      "chunk": {
        "type": "text-delta",
        "textLen": 5
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 153,
      "chunk": {
        "type": "text-delta",
        "textLen": 2
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 154,
      "chunk": {
        "type": "text-delta",
        "textLen": 3
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 155,
      "chunk": {
        "type": "text-delta",
        "textLen": 1
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 156,
      "chunk": {
        "type": "text-delta",
        "textLen": 4
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 157,
      "chunk": {
        "type": "text-delta",
        "textLen": 7
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 158,
      "chunk": {
        "type": "text-delta",
        "textLen": 9
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 159,
      "chunk": {
        "type": "text-delta",
        "textLen": 1
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 160,
      "chunk": {
        "type": "text-delta",
        "textLen": 6
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 161,
      "chunk": {
        "type": "text-delta",
        "textLen": 1
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 162,
      "chunk": {
        "type": "text-delta",
        "textLen": 7
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 163,
      "chunk": {
        "type": "text-delta",
        "textLen": 6
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 164,
      "chunk": {
        "type": "text-delta",
        "textLen": 2
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 165,
      "chunk": {
        "type": "text-delta",
        "textLen": 1
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 166,
      "chunk": {
        "type": "text-delta",
        "textLen": 10
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 167,
      "chunk": {
        "type": "text-delta",
        "textLen": 5
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 168,
      "chunk": {
        "type": "text-delta",
        "textLen": 9
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 169,
      "chunk": {
        "type": "text-delta",
        "textLen": 2
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 170,
      "chunk": {
        "type": "text-delta",
        "textLen": 4
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 171,
      "chunk": {
        "type": "text-delta",
        "textLen": 4
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 172,
      "chunk": {
        "type": "text-delta",
        "textLen": 3
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 173,
      "chunk": {
        "type": "text-delta",
        "textLen": 5
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 174,
      "chunk": {
        "type": "text-delta",
        "textLen": 4
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 175,
      "chunk": {
        "type": "text-delta",
        "textLen": 2
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 176,
      "chunk": {
        "type": "text-delta",
        "textLen": 3
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 177,
      "chunk": {
        "type": "text-delta",
        "textLen": 4
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 178,
      "chunk": {
        "type": "text-delta",
        "textLen": 8
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 179,
      "chunk": {
        "type": "text-delta",
        "textLen": 1
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 180,
      "chunk": {
        "type": "block-end",
        "textLen": 0
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 181,
      "chunk": {
        "type": "block-end",
        "textLen": 0
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 182,
      "chunk": {
        "type": "usage",
        "textLen": 0
      }
    },
    {
      "type": "assistant/chunk",
      "seq": 183,
      "chunk": {
        "type": "finish",
        "textLen": 0
      }
    },
    {
      "type": "assistant/message",
      "seq": 184
    },
    {
      "type": "step/end",
      "seq": 185
    },
    {
      "type": "turn/end",
      "seq": 186
    }
  ],
  "historyAfterTurn": {
    "type": "server-response",
    "rpcId": "c8b67b5b-569e-43c2-ae04-1bc607130172",
    "result": {
      "ok": true,
      "value": {
        "events": [
          {
            "type": "user/message",
            "seq": 9
          },
          {
            "type": "user/message",
            "seq": 10
          },
          {
            "type": "session/title",
            "seq": 11
          },
          {
            "type": "request/header",
            "seq": 12
          },
          {
            "type": "request/context",
            "seq": 13
          },
          {
            "type": "session/title-llm-request",
            "seq": 14
          },
          {
            "type": "session/title",
            "seq": 15
          },
          {
            "type": "assistant/chunk",
            "seq": 16
          },
          {
            "type": "assistant/chunk",
            "seq": 17
          },
          {
            "type": "assistant/chunk",
            "seq": 18
          },
          {
            "type": "assistant/chunk",
            "seq": 19
          },
          {
            "type": "assistant/chunk",
            "seq": 20
          },
          {
            "type": "assistant/chunk",
            "seq": 21
          },
          {
            "type": "assistant/chunk",
            "seq": 22
          },
          {
            "type": "assistant/chunk",
            "seq": 23
          },
          {
            "type": "assistant/chunk",
            "seq": 24
          },
          {
            "type": "assistant/chunk",
            "seq": 25
          },
          {
            "type": "assistant/chunk",
            "seq": 26
          },
          {
            "type": "assistant/chunk",
            "seq": 27
          },
          {
            "type": "assistant/chunk",
            "seq": 28
          },
          {
            "type": "assistant/chunk",
            "seq": 29
          },
          {
            "type": "assistant/chunk",
            "seq": 30
          },
          {
            "type": "assistant/chunk",
            "seq": 31
          },
          {
            "type": "assistant/chunk",
            "seq": 32
          },
          {
            "type": "assistant/chunk",
            "seq": 33
          },
          {
            "type": "assistant/chunk",
            "seq": 34
          },
          {
            "type": "assistant/chunk",
            "seq": 35
          },
          {
            "type": "assistant/chunk",
            "seq": 36
          },
          {
            "type": "assistant/chunk",
            "seq": 37
          },
          {
            "type": "assistant/chunk",
            "seq": 38
          },
          {
            "type": "assistant/chunk",
            "seq": 39
          },
          {
            "type": "assistant/chunk",
            "seq": 40
          },
          {
            "type": "assistant/chunk",
            "seq": 41
          },
          {
            "type": "assistant/chunk",
            "seq": 42
          },
          {
            "type": "assistant/chunk",
            "seq": 43
          },
          {
            "type": "assistant/chunk",
            "seq": 44
          },
          {
            "type": "assistant/chunk",
            "seq": 45
          },
          {
            "type": "assistant/chunk",
            "seq": 46
          },
          {
            "type": "assistant/chunk",
            "seq": 47
          },
          {
            "type": "assistant/chunk",
            "seq": 48
          },
          {
            "type": "assistant/chunk",
            "seq": 49
          },
          {
            "type": "assistant/chunk",
            "seq": 50
          },
          {
            "type": "assistant/chunk",
            "seq": 51
          },
          {
            "type": "assistant/chunk",
            "seq": 52
          },
          {
            "type": "assistant/chunk",
            "seq": 53
          },
          {
            "type": "assistant/chunk",
            "seq": 54
          },
          {
            "type": "assistant/chunk",
            "seq": 55
          },
          {
            "type": "assistant/chunk",
            "seq": 56
          },
          {
            "type": "assistant/chunk",
            "seq": 57
          },
          {
            "type": "assistant/chunk",
            "seq": 58
          },
          {
            "type": "assistant/chunk",
            "seq": 59
          },
          {
            "type": "assistant/chunk",
            "seq": 60
          },
          {
            "type": "assistant/chunk",
            "seq": 61
          },
          {
            "type": "assistant/chunk",
            "seq": 62
          },
          {
            "type": "assistant/chunk",
            "seq": 63
          },
          {
            "type": "assistant/chunk",
            "seq": 64
          },
          {
            "type": "assistant/chunk",
            "seq": 65
          },
          {
            "type": "assistant/chunk",
            "seq": 66
          },
          {
            "type": "assistant/chunk",
            "seq": 67
          },
          {
            "type": "assistant/chunk",
            "seq": 68
          },
          {
            "type": "assistant/chunk",
            "seq": 69
          },
          {
            "type": "assistant/chunk",
            "seq": 70
          },
          {
            "type": "assistant/chunk",
            "seq": 71
          },
          {
            "type": "assistant/chunk",
            "seq": 72
          },
          {
            "type": "assistant/chunk",
            "seq": 73
          },
          {
            "type": "assistant/chunk",
            "seq": 74
          },
          {
            "type": "assistant/chunk",
            "seq": 75
          },
          {
            "type": "assistant/chunk",
            "seq": 76
          },
          {
            "type": "assistant/chunk",
            "seq": 77
          },
          {
            "type": "assistant/chunk",
            "seq": 78
          },
          {
            "type": "assistant/chunk",
            "seq": 79
          },
          {
            "type": "assistant/chunk",
            "seq": 80
          },
          {
            "type": "assistant/chunk",
            "seq": 81
          },
          {
            "type": "assistant/chunk",
            "seq": 82
          },
          {
            "type": "assistant/chunk",
            "seq": 83
          },
          {
            "type": "assistant/chunk",
            "seq": 84
          },
          {
            "type": "assistant/chunk",
            "seq": 85
          },
          {
            "type": "assistant/chunk",
            "seq": 86
          },
          {
            "type": "assistant/chunk",
            "seq": 87
          },
          {
            "type": "assistant/chunk",
            "seq": 88
          },
          {
            "type": "assistant/chunk",
            "seq": 89
          },
          {
            "type": "assistant/chunk",
            "seq": 90
          },
          {
            "type": "assistant/chunk",
            "seq": 91
          },
          {
            "type": "assistant/chunk",
            "seq": 92
          },
          {
            "type": "assistant/chunk",
            "seq": 93
          },
          {
            "type": "assistant/chunk",
            "seq": 94
          },
          {
            "type": "assistant/chunk",
            "seq": 95
          },
          {
            "type": "assistant/chunk",
            "seq": 96
          },
          {
            "type": "assistant/chunk",
            "seq": 97
          },
          {
            "type": "assistant/chunk",
            "seq": 98
          },
          {
            "type": "assistant/chunk",
            "seq": 99
          },
          {
            "type": "assistant/chunk",
            "seq": 100
          },
          {
            "type": "assistant/chunk",
            "seq": 101
          },
          {
            "type": "assistant/chunk",
            "seq": 102
          },
          {
            "type": "assistant/chunk",
            "seq": 103
          },
          {
            "type": "assistant/chunk",
            "seq": 104
          },
          {
            "type": "assistant/chunk",
            "seq": 105
          },
          {
            "type": "assistant/chunk",
            "seq": 106
          },
          {
            "type": "assistant/chunk",
            "seq": 107
          },
          {
            "type": "assistant/chunk",
            "seq": 108
          },
          {
            "type": "assistant/chunk",
            "seq": 109
          },
          {
            "type": "assistant/chunk",
            "seq": 110
          },
          {
            "type": "assistant/chunk",
            "seq": 111
          },
          {
            "type": "assistant/chunk",
            "seq": 112
          },
          {
            "type": "assistant/chunk",
            "seq": 113
          },
          {
            "type": "assistant/chunk",
            "seq": 114
          },
          {
            "type": "assistant/chunk",
            "seq": 115
          },
          {
            "type": "assistant/chunk",
            "seq": 116
          },
          {
            "type": "assistant/chunk",
            "seq": 117
          },
          {
            "type": "assistant/chunk",
            "seq": 118
          },
          {
            "type": "assistant/chunk",
            "seq": 119
          },
          {
            "type": "assistant/chunk",
            "seq": 120
          },
          {
            "type": "assistant/chunk",
            "seq": 121
          },
          {
            "type": "assistant/chunk",
            "seq": 122
          },
          {
            "type": "assistant/chunk",
            "seq": 123
          },
          {
            "type": "assistant/chunk",
            "seq": 124
          },
          {
            "type": "assistant/chunk",
            "seq": 125
          },
          {
            "type": "assistant/chunk",
            "seq": 126
          },
          {
            "type": "assistant/chunk",
            "seq": 127
          },
          {
            "type": "assistant/chunk",
            "seq": 128
          },
          {
            "type": "assistant/chunk",
            "seq": 129
          },
          {
            "type": "assistant/chunk",
            "seq": 130
          },
          {
            "type": "assistant/chunk",
            "seq": 131
          },
          {
            "type": "assistant/chunk",
            "seq": 132
          },
          {
            "type": "assistant/chunk",
            "seq": 133
          },
          {
            "type": "assistant/chunk",
            "seq": 134
          },
          {
            "type": "assistant/chunk",
            "seq": 135
          },
          {
            "type": "assistant/chunk",
            "seq": 136
          },
          {
            "type": "assistant/chunk",
            "seq": 137
          },
          {
            "type": "assistant/chunk",
            "seq": 138
          },
          {
            "type": "assistant/chunk",
            "seq": 139
          },
          {
            "type": "assistant/chunk",
            "seq": 140
          },
          {
            "type": "assistant/chunk",
            "seq": 141
          },
          {
            "type": "assistant/chunk",
            "seq": 142
          },
          {
            "type": "assistant/chunk",
            "seq": 143
          },
          {
            "type": "assistant/chunk",
            "seq": 144
          },
          {
            "type": "assistant/chunk",
            "seq": 145
          },
          {
            "type": "assistant/chunk",
            "seq": 146
          },
          {
            "type": "assistant/chunk",
            "seq": 147
          },
          {
            "type": "assistant/chunk",
            "seq": 148
          },
          {
            "type": "assistant/chunk",
            "seq": 149
          },
          {
            "type": "assistant/chunk",
            "seq": 150
          },
          {
            "type": "assistant/chunk",
            "seq": 151
          },
          {
            "type": "assistant/chunk",
            "seq": 152
          },
          {
            "type": "assistant/chunk",
            "seq": 153
          },
          {
            "type": "assistant/chunk",
            "seq": 154
          },
          {
            "type": "assistant/chunk",
            "seq": 155
          },
          {
            "type": "assistant/chunk",
            "seq": 156
          },
          {
            "type": "assistant/chunk",
            "seq": 157
          },
          {
            "type": "assistant/chunk",
            "seq": 158
          },
          {
            "type": "assistant/chunk",
            "seq": 159
          },
          {
            "type": "assistant/chunk",
            "seq": 160
          },
          {
            "type": "assistant/chunk",
            "seq": 161
          },
          {
            "type": "assistant/chunk",
            "seq": 162
          },
          {
            "type": "assistant/chunk",
            "seq": 163
          },
          {
            "type": "assistant/chunk",
            "seq": 164
          },
          {
            "type": "assistant/chunk",
            "seq": 165
          },
          {
            "type": "assistant/chunk",
            "seq": 166
          },
          {
            "type": "assistant/chunk",
            "seq": 167
          },
          {
            "type": "assistant/chunk",
            "seq": 168
          },
          {
            "type": "assistant/chunk",
            "seq": 169
          },
          {
            "type": "assistant/chunk",
            "seq": 170
          },
          {
            "type": "assistant/chunk",
            "seq": 171
          },
          {
            "type": "assistant/chunk",
            "seq": 172
          },
          {
            "type": "assistant/chunk",
            "seq": 173
          },
          {
            "type": "assistant/chunk",
            "seq": 174
          },
          {
            "type": "assistant/chunk",
            "seq": 175
          },
          {
            "type": "assistant/chunk",
            "seq": 176
          },
          {
            "type": "assistant/chunk",
            "seq": 177
          },
          {
            "type": "assistant/chunk",
            "seq": 178
          },
          {
            "type": "assistant/chunk",
            "seq": 179
          },
          {
            "type": "assistant/chunk",
            "seq": 180
          },
          {
            "type": "assistant/chunk",
            "seq": 181
          },
          {
            "type": "assistant/chunk",
            "seq": 182
          },
          {
            "type": "assistant/chunk",
            "seq": 183
          },
          {
            "type": "assistant/message",
            "seq": 184
          },
          {
            "type": "step/end",
            "seq": 185
          },
          {
            "type": "turn/end",
            "seq": 186
          }
        ],
        "hasMore": true,
        "projections": {
          "asOfSeq": 186,
          "values": {
            "sessionStats": {
              "turns": 1,
              "steps": 1,
              "llmMs": 2299,
              "toolMs": 0,
              "ttftMs": 1112,
              "ttftSteps": 1,
              "decodeMs": 1187,
              "decodeTokens": 164
            },
            "title": "Hi",
            "goal": null,
            "tokenUsage": {
              "uncachedInputTokens": 4,
              "outputTokens": 164,
              "cacheReadTokens": 9344,
              "cacheWriteTokens": 0
            },
            "contextPressure": {
              "pressureTokens": 9348,
              "projectedTokens": 9524,
              "contextWindow": 1000000
            },
            "contextBreakdown": {
              "systemTokens": 1514,
              "toolsTokens": 6376,
              "messageTokens": 1411
            },
            "subagentTiming": {
              "settledMs": 0
            },
            "subagent": null,
            "permissions": {
              "options": [
                {
                  "value": "read-only",
                  "name": "read-only"
                },
                {
                  "value": "workspace-write",
                  "name": "workspace-write"
                },
                {
                  "value": "danger-full-access",
                  "name": "danger-full-access"
                }
              ],
              "currentValue": "workspace-write"
            },
            "sessionListMetadata": {
              "blank": false,
              "lastPromptAt": 1786761315397
            },
            "imageLimits": {
              "maxImageBytes": 5242880,
              "maxImagesPerMessage": 20,
              "maxMessageImageBytes": 104857600,
              "maxImagePixels": 40000000,
              "mediaTypes": [
                "image/png",
                "image/jpeg",
                "image/webp",
                "image/gif"
              ]
            },
            "todos": null,
            "plan": {
              "active": false,
              "pending": false
            }
          }
        }
      }
    }
  }
}
```
