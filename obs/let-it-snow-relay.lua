--[[
Let It Snow — relay launcher for OBS Studio (Tools → Scripts → +).

Starts the bundled let-it-snow-relay executable together with OBS, stops it when
OBS closes and creates/updates a "Let It Snow" Browser Source with the overlay URL.

Security:
  * the relay listens on 127.0.0.1 only;
  * the token is generated from the OS random source and passed to the relay through
    the SNOW_RELAY_TOKEN environment variable, never on the command line;
  * the relay exits by itself if OBS crashes (--parent-pid).
]]

local obs = obslua
local ffi = require("ffi")

local IS_WINDOWS = ffi.os == "Windows"
local EXE_NAME = IS_WINDOWS and "let-it-snow-relay.exe" or "let-it-snow-relay"
local DEFAULT_PORT = 8787
local DEFAULT_SOURCE_NAME = "Let It Snow"
local TOKEN_ENV = "SNOW_RELAY_TOKEN"

local current_settings = nil
local relay = { handle = nil, pid = nil, pid_file = nil, port = nil }
local status_text = "Relay is stopped."

-- ---------------------------------------------------------------------------
-- Platform helpers
-- ---------------------------------------------------------------------------

if IS_WINDOWS then
  ffi.cdef([[
    typedef struct {
      uint32_t cb; void* lpReserved; void* lpDesktop; void* lpTitle;
      uint32_t dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
      uint16_t wShowWindow, cbReserved2; void* lpReserved2;
      void* hStdInput; void* hStdOutput; void* hStdError;
    } LIS_STARTUPINFOW;
    typedef struct { void* hProcess; void* hThread; uint32_t dwProcessId; uint32_t dwThreadId; } LIS_PROCESS_INFORMATION;
    int CreateProcessW(const uint16_t* app, uint16_t* cmd, void* pa, void* ta, int inherit,
                       uint32_t flags, void* env, const uint16_t* cwd,
                       LIS_STARTUPINFOW* si, LIS_PROCESS_INFORMATION* pi);
    int TerminateProcess(void* h, uint32_t code);
    int CloseHandle(void* h);
    int GetExitCodeProcess(void* h, uint32_t* code);
    uint32_t GetCurrentProcessId(void);
    uint32_t GetLastError(void);
    int MultiByteToWideChar(uint32_t cp, uint32_t flags, const char* str, int len, uint16_t* out, int outlen);
    int SetEnvironmentVariableW(const uint16_t* name, const uint16_t* value);
    int SystemFunction036(void* buf, uint32_t len);
  ]])
else
  ffi.cdef([[
    int getpid(void);
    int setenv(const char* name, const char* value, int overwrite);
    int unsetenv(const char* name);
  ]])
end

local function utf16(str)
  local len = ffi.C.MultiByteToWideChar(65001, 0, str, -1, nil, 0)
  local buf = ffi.new("uint16_t[?]", len)
  ffi.C.MultiByteToWideChar(65001, 0, str, -1, buf, len)
  return buf
end

local function random_hex(bytes)
  local raw = nil
  if IS_WINDOWS then
    local ok, advapi = pcall(ffi.load, "advapi32")
    if ok then
      local buf = ffi.new("uint8_t[?]", bytes)
      if advapi.SystemFunction036(buf, bytes) ~= 0 then raw = ffi.string(buf, bytes) end
    end
  else
    local f = io.open("/dev/urandom", "rb")
    if f then
      raw = f:read(bytes)
      f:close()
    end
  end
  if raw == nil or #raw ~= bytes then return nil end
  return (raw:gsub(".", function(c) return string.format("%02x", c:byte()) end))
end

local function is_valid_token(token)
  return type(token) == "string" and #token >= 24 and #token <= 256 and token:match("^[%w_%-%.~%+/=]+$") ~= nil
end

local function url_encode(str)
  return (str:gsub("[^%w%-%._~]", function(c) return string.format("%%%02X", c:byte()) end))
end

local function file_exists(path)
  local f = io.open(path, "rb")
  if f then f:close() return true end
  return false
end

local function shell_quote(str)
  return "'" .. str:gsub("'", "'\\''") .. "'"
end

local function shell_ok(cmd)
  local result = os.execute(cmd)
  return result == 0 or result == true
end

local function set_token_env(token)
  if IS_WINDOWS then
    ffi.C.SetEnvironmentVariableW(utf16(TOKEN_ENV), token and utf16(token) or nil)
  elseif token then
    ffi.C.setenv(TOKEN_ENV, token, 1)
  else
    ffi.C.unsetenv(TOKEN_ENV)
  end
end

-- ---------------------------------------------------------------------------
-- Relay process
-- ---------------------------------------------------------------------------

local function default_relay_path()
  return script_path() .. EXE_NAME
end

local function relay_path(settings)
  local path = obs.obs_data_get_string(settings, "relay_path")
  if path == nil or path == "" then return default_relay_path() end
  return path
end

local function ensure_token(settings)
  local token = obs.obs_data_get_string(settings, "token")
  if is_valid_token(token) then return token end
  token = random_hex(32)
  if token == nil then
    obs.script_log(obs.LOG_ERROR, "[Let It Snow] Secure random source is unavailable; set a token manually.")
    return nil
  end
  obs.obs_data_set_string(settings, "token", token)
  return token
end

local function overlay_url(settings)
  local port = obs.obs_data_get_int(settings, "port")
  local token = obs.obs_data_get_string(settings, "token")
  local query = "renderer=" .. url_encode(obs.obs_data_get_string(settings, "renderer"))
  local extra = obs.obs_data_get_string(settings, "extra_query")
  if extra ~= nil and extra ~= "" then
    query = query .. "&" .. extra:gsub("^[?&]+", ""):gsub("#.*$", "")
  end
  return string.format("http://127.0.0.1:%d/obs/?%s#token=%s", port, query, url_encode(token))
end

local function is_relay_running()
  if IS_WINDOWS then
    if relay.handle == nil then return false end
    local code = ffi.new("uint32_t[1]")
    return ffi.C.GetExitCodeProcess(relay.handle, code) ~= 0 and code[0] == 259 -- STILL_ACTIVE
  end
  if relay.pid == nil then return false end
  return shell_ok("kill -0 " .. relay.pid .. " 2>/dev/null")
end

local check_relay_started

local function stop_relay()
  obs.timer_remove(check_relay_started)
  if IS_WINDOWS then
    if relay.handle ~= nil then
      ffi.C.TerminateProcess(relay.handle, 0)
      ffi.C.CloseHandle(relay.handle)
      relay.handle = nil
    end
  else
    if relay.pid ~= nil then os.execute("kill " .. relay.pid .. " 2>/dev/null") end
    if relay.pid_file ~= nil then os.remove(relay.pid_file) end
    relay.pid = nil
    relay.pid_file = nil
  end
  status_text = "Relay is stopped."
end

check_relay_started = function()
  obs.timer_remove(check_relay_started)
  if not IS_WINDOWS and relay.pid == nil and relay.pid_file ~= nil then
    -- The relay writes its pid file only after the port is bound.
    local f = io.open(relay.pid_file, "r")
    if f then
      relay.pid = tonumber(f:read("*l"))
      f:close()
    end
  end
  if is_relay_running() then
    status_text = string.format("Relay is running on 127.0.0.1:%d.", relay.port)
    obs.script_log(obs.LOG_INFO, "[Let It Snow] " .. status_text)
  else
    stop_relay()
    status_text = string.format("Relay failed to start (port %d busy or executable blocked).", relay.port or 0)
    obs.script_log(obs.LOG_WARNING, "[Let It Snow] " .. status_text)
  end
end

local function start_relay(settings)
  stop_relay()
  local exe = relay_path(settings)
  if not file_exists(exe) then
    status_text = "Relay executable not found: " .. exe
    obs.script_log(obs.LOG_ERROR, "[Let It Snow] " .. status_text)
    return false
  end
  local token = ensure_token(settings)
  if token == nil then return false end
  local port = obs.obs_data_get_int(settings, "port")
  relay.port = port

  set_token_env(token)
  if IS_WINDOWS then
    local cmd = string.format('"%s" --port %d --quiet --parent-pid %d', exe, port, ffi.C.GetCurrentProcessId())
    local si = ffi.new("LIS_STARTUPINFOW")
    si.cb = ffi.sizeof(si)
    local pi = ffi.new("LIS_PROCESS_INFORMATION")
    local CREATE_NO_WINDOW = 0x08000000
    local ok = ffi.C.CreateProcessW(utf16(exe), utf16(cmd), nil, nil, 0, CREATE_NO_WINDOW, nil, nil, si, pi)
    set_token_env(nil)
    if ok == 0 then
      status_text = "Cannot start relay (Windows error " .. ffi.C.GetLastError() .. ")."
      obs.script_log(obs.LOG_ERROR, "[Let It Snow] " .. status_text)
      return false
    end
    ffi.C.CloseHandle(pi.hThread)
    relay.handle = pi.hProcess
  else
    local tmp = os.getenv("TMPDIR") or "/tmp/"
    if tmp:sub(-1) ~= "/" then tmp = tmp .. "/" end
    relay.pid_file = string.format("%slet-it-snow-relay-%d.pid", tmp, port)
    os.remove(relay.pid_file)
    os.execute(string.format("%s --port %d --quiet --parent-pid %d --pid-file %s >/dev/null 2>&1 &",
      shell_quote(exe), port, ffi.C.getpid(), shell_quote(relay.pid_file)))
    set_token_env(nil)
  end
  status_text = "Relay is starting…"
  obs.timer_add(check_relay_started, 1500)
  return true
end

-- ---------------------------------------------------------------------------
-- Browser source
-- ---------------------------------------------------------------------------

local function upsert_browser_source(settings)
  if ensure_token(settings) == nil then return end
  local name = obs.obs_data_get_string(settings, "source_name")
  if name == nil or name == "" then name = DEFAULT_SOURCE_NAME end

  local video = obs.obs_video_info()
  local width, height = 1920, 1080
  if obs.obs_get_video_info(video) then
    width, height = video.base_width, video.base_height
  end

  local data = obs.obs_data_create()
  obs.obs_data_set_bool(data, "is_local_file", false)
  obs.obs_data_set_string(data, "url", overlay_url(settings))
  obs.obs_data_set_int(data, "width", width)
  obs.obs_data_set_int(data, "height", height)
  obs.obs_data_set_int(data, "fps", 60)
  obs.obs_data_set_bool(data, "shutdown", false)

  local source = obs.obs_get_source_by_name(name)
  if source ~= nil then
    obs.obs_source_update(source, data)
    obs.obs_source_release(source)
    status_text = "Browser source \"" .. name .. "\" updated."
  else
    source = obs.obs_source_create("browser_source", name, data, nil)
    local scene_source = obs.obs_frontend_get_current_scene()
    if scene_source ~= nil then
      local scene = obs.obs_scene_from_source(scene_source)
      obs.obs_scene_add(scene, source)
      obs.obs_source_release(scene_source)
    end
    obs.obs_source_release(source)
    status_text = "Browser source \"" .. name .. "\" added to the current scene."
  end
  obs.obs_data_release(data)
  obs.script_log(obs.LOG_INFO, "[Let It Snow] " .. status_text)
end

-- ---------------------------------------------------------------------------
-- OBS script API
-- ---------------------------------------------------------------------------

function script_description()
  return [[<h3>❄ Let It Snow — relay</h3>
<p>Runs the local Let It Snow relay together with OBS and adds the snow overlay as a Browser Source.
Copy the token into the extension popup (API tab) to sync browsers and send commands.</p>
<p>Запускает локальный relay Let It Snow вместе с OBS и добавляет оверлей снега как источник «Браузер».</p>]]
end

function script_properties()
  local props = obs.obs_properties_create()
  obs.obs_properties_add_text(props, "status_info", status_text, obs.OBS_TEXT_INFO)
  obs.obs_properties_add_bool(props, "autostart", "Start relay with OBS")
  obs.obs_properties_add_path(props, "relay_path", "Relay executable", obs.OBS_PATH_FILE,
    IS_WINDOWS and "Executable (*.exe)" or "All files (*)", script_path())
  obs.obs_properties_add_int(props, "port", "Port", 1024, 65535, 1)
  obs.obs_properties_add_text(props, "token", "Token", obs.OBS_TEXT_PASSWORD)
  obs.obs_properties_add_button(props, "regenerate_token", "Generate new token", function()
    if current_settings == nil then return false end
    obs.obs_data_set_string(current_settings, "token", "")
    ensure_token(current_settings)
    if is_relay_running() then start_relay(current_settings) end
    upsert_browser_source(current_settings)
    return true
  end)

  local renderer = obs.obs_properties_add_list(props, "renderer", "Renderer",
    obs.OBS_COMBO_TYPE_LIST, obs.OBS_COMBO_FORMAT_STRING)
  obs.obs_property_list_add_string(renderer, "3D", "3d")
  obs.obs_property_list_add_string(renderer, "Auto (2D / WebGPU)", "auto")
  obs.obs_properties_add_text(props, "extra_query", "Extra overlay options (e.g. snowmax=120&wind=1)",
    obs.OBS_TEXT_DEFAULT)
  obs.obs_properties_add_text(props, "source_name", "Browser source name", obs.OBS_TEXT_DEFAULT)

  obs.obs_properties_add_button(props, "start_relay", "Start / restart relay", function()
    if current_settings ~= nil then start_relay(current_settings) end
    return true
  end)
  obs.obs_properties_add_button(props, "stop_relay", "Stop relay", function()
    stop_relay()
    return true
  end)
  obs.obs_properties_add_button(props, "add_source", "Add / update browser source", function()
    if current_settings ~= nil then upsert_browser_source(current_settings) end
    return true
  end)
  return props
end

function script_defaults(settings)
  obs.obs_data_set_default_bool(settings, "autostart", true)
  obs.obs_data_set_default_int(settings, "port", DEFAULT_PORT)
  obs.obs_data_set_default_string(settings, "renderer", "3d")
  obs.obs_data_set_default_string(settings, "source_name", DEFAULT_SOURCE_NAME)
  obs.obs_data_set_default_string(settings, "relay_path", default_relay_path())
end

function script_update(settings)
  current_settings = settings
end

function script_load(settings)
  current_settings = settings
  ensure_token(settings)
  if obs.obs_data_get_bool(settings, "autostart") then start_relay(settings) end
end

function script_unload()
  stop_relay()
end
