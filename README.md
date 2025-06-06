# PvP-Scalpel-backend

This API manages the database and delivers data to the front-end.

## REST API Routes

All REST endpoints return data in JSON format.

---

### GET `/member/list`

Returns an array of objects containing guild member data.

#### Each player object includes:
- name
- realm
- server
- guild data
- character media

Sorted by guild rank (lower number = higher rank).

---

### PATCH `/member/patch`

Updates the API's local database with member data and ranks retrieved from the Blizzard API.

Returns an array of updated member objects, sorted by guild rank.

---

### GET `/LDB/2v2`, `/LDB/3v3`, `/LDB/solo`, `/LDB/blitz`, `/LDB/BG`

Returns an array of objects sorted by rating for the requested bracket.

#### Each object contains:
- name
- realm
- server
- race
- class
- active player spec
- rating (for the bracket)
- achievements (for the bracket)
- character media

---

### GET `/checkCharacter/:server/:realm/:name`

#### Dynamic params:
- `server`: Player's server name
- `realm`: Realm slug in kebab-case (e.g. `burning-blade`)
- `name`: Player's name

#### Response:

**200 OK**
```json
{
  "_id": "string",
  "blizID": number,
  "name": "string",
  "realm": { ... },
  "level": number,
  "faction": "string",
  "class": { ... },
  "activeSpec": { ... },
  "rating": { ... },
  "achieves": { ... },
  "media": { ... },
  "checkedCount": number,
  "server": "string",
  "gear": { ... },
  "lastLogin": number,
  "equipmentStats": { ... },
  "likes": [],
  "guildMember": true,
  "guildInsight": { ... },
  "posts": []
}
```

**404 Not Found**
```json
{ "message": "No character with these credentials (bad parameters)" }
```

**500 Server Error**
```json
{ "message": "Error retrieving the data" }
```

---

### PATCH `/patchCharacter/:server/:realm/:name`

#### Logic:
Fetches and stores fresh data from the Blizzard API.

Returns the same object as the `GET /checkCharacter/:server/:realm/:name` route.

---

### PATCH `/patchPvPData/:server/:realm/:name`

#### Logic:
Fetches and stores fresh PvP data from the Blizzard API.

Returns the full updated character object, same as `GET /checkCharacter`.

---

## Authentication / Session Routes

### 🔐 Privacy & Session Tracking Disclaimer

This application tracks user sessions for authentication, security, and account protection purposes.

The following information may be collected during login:
- Browser type and version
- Operating system platform
- Language and timezone
- Device memory and CPU information

This data may be temporarily stored and used to:
- Detect suspicious login attempts
- Manage active sessions across devices
- Improve security through browser fingerprinting

**Note**: This data is not used for advertising and is never shared with third parties.

By using this application, you agree to this usage for security and session management purposes.

---

### 🔐 Encryption

The application does not store passwords or tokens in AS IS format they are encrypted and not readable or reversable.

---

### POST `/login`

#### Expected JSON body:
- `email`: String
- `password`: String (plaintext)
- `fingerprint`: Object (see example image below)

![Fingerprint JSON object example](./README_ASSETS/fprint.png)

#### Response:

**200 OK**
```json
{
    "_id": "string",
    "email": "string",
    "username": "string",
    "isVerified": Boolean,
    "role": "string",
    "fingerprint": { ... }
}
```

**400 - 409 bad credentials**

---

### POST `/register`

#### Expected JSON body:
- `email`: String
- `username`: String
- `password`: String (plaintext)
- `fingerprint`: Object (SAME AS `/login`)

#### Logic:
Attempt to make a new account

#### Response:

**200 OK**
```json
{
    "_id": "string",
    "email": "string",
    "username": "string",
    "isVerified": Boolean,
    "role": "string",
    "fingerprint": { ... }
}
```
and a cookie with jwt for auth and session, sending verification e-mail on the provided one

**400 - 409 bad credentials**

---

### PATCH `/change/email`

#### Expected JSON body:
```json 
{ "newEmail": "String" } 
```

#### Expected Signed by the back-end session cookie

#### Logic:

Attempts to change the user email

#### Response:

**201 Created**
The same JSON as the login request + 
```json
{ "newEmail": "String" } 
```

and sends email with 6 digit code to the provided new email.

**400 Not Valid Email**

The provided new email's invalid

**409 Conflict**

The provided email already exists / being used

**403 Forbiden**

No access due to missing a signed or failing JWT

**500 Internal Server Error**

### PATCH `/change/password`

#### Expected JSON body:
```json
{
  "password": "String (the old password)",
  "newPassword": "String (the new password)" 
}
```

#### Expected Signed by the back-end session cookie

#### Response

**201 Created**

The server successfully patched the old password with the new password

**401 Bad Password**

The provided current Passowrd is not passing the validation (incorect Password)

**500 Internal Server error**

---

### PATCH `/change/username`

#### Expected JSON body:
```json
{
  "newUsername": "String (the new username)" 
}
```

#### Expected Signed by the back-end session cookie


#### Response

**201 Created**

Successfull attempt to change the username

Returning updated login Object in a JSON same as the `/login` route

**403 Not Authorized**

Failing the JWT validation and clears the cookie

**400 New Username**

The new username is the same as the old one

**409 Conflict**

The new username's already in use

**500 Internal Server Error**

---

### POST `/reset/password`

#### Expected JSON body:

```json
{
  "email": "String (the user's email)",
  "fingerprint": "Object (check the image in the /login path)"
}
```

#### Response

**201 Created**

Successfull attempt to rest the user's password next step is confirmation 
1. GOTO the profile's email
2. Click the link (contains link to the Front-End with JWT)

```json

{  "message" : "Email send at ${email}!"  }

```

**404 Not Found**

The email does not exist in the database (no user registered with the provided email)

**400 Already send**

The email for the reset is already sent

**500 Internal Server Error**

---

### PATCH `/reset/password`
    
#### Logic
    
Attempts to store the new password and update it.

#### Expected JSON body:

```json
  {
    "JWT": "String (issued by the back-end JWT)",
    "newPassword": "String (the new password)"
  }
```

#### Response

**201 Created**

Successfull password update

**403 Forbiden**

JWT validation fails or bad JWT body 

**500 Internal Server Error**

---

### PATCH `/validate/token`

#### Logic

This route is for validationg e-mail vaidations with the 6-digit method

#### Expected JSON body:

```json
  {
    "token": "Number (6-digits from the email)",
    "option": "String (`verify` for email verification after registration or `email` for email change)"
  }
```

#### Case `verify`

##### => Response

**201 Created**

A login JSON with object same as in the route `/login` and a session cookie. The user status is now verified.

#### Case `email`

##### => Response

**201 Created**

Successfull attempt on e-mail change returning a signed JWT cookie and a login object in a JSON same as in the route `/login`

#### General Responses (same for both cases)

**401 Bad Token**

The issued token and the provided one differs

**400 Bad option**

The route's supported options are:

1. `verifiy`
2. `email` 

**500 Internal Server Error**

---

### GET `/verify/me`

#### Logic

Check if there's a valid signed session with a JWT issued by the back-end and returns a valid
login object if all the checkup passes

---

### GET `/logout`

### Logic

Delete any existing session cookie and return **Status 200**