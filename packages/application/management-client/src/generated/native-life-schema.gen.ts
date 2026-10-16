// Generated from the Host OpenAPI owner. Do not edit.
export const nativeLifeActionSchema = {
  "anyOf": [
    {
      "type": "object",
      "required": [
        "action"
      ],
      "properties": {
        "action": {
          "type": "string",
          "enum": [
            "inspect"
          ]
        }
      },
      "additionalProperties": false
    },
    {
      "type": "object",
      "required": [
        "action",
        "note",
        "expectedRevision",
        "nextOpportunity",
        "mode"
      ],
      "properties": {
        "action": {
          "type": "string",
          "enum": [
            "progress"
          ]
        },
        "note": {
          "type": "string",
          "minLength": 1,
          "maxLength": 4000
        },
        "expectedRevision": {
          "type": "integer",
          "minimum": 1
        },
        "nextOpportunity": {
          "anyOf": [
            {
              "type": "object",
              "required": [
                "timeDomainRef",
                "at"
              ],
              "properties": {
                "timeDomainRef": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 2048
                },
                "at": {
                  "type": "string",
                  "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?Z$"
                }
              },
              "additionalProperties": false
            },
            {
              "type": "null"
            }
          ]
        },
        "mode": {
          "anyOf": [
            {
              "type": "string",
              "enum": [
                "work"
              ]
            },
            {
              "type": "string",
              "enum": [
                "rest"
              ]
            },
            {
              "type": "string",
              "enum": [
                "wait"
              ]
            }
          ]
        }
      },
      "additionalProperties": false
    }
  ]
} as const;
