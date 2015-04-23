
const SMI = require("smi.cli");
const SPAWN = require("child_process").spawn;
const CRYPTO = require("crypto");


const DEFAULT_BROWSER_VERSION = "30.0";


exports.for = function (API) {

	var exports = {};

	function ensureProfilePath () {
		return API.Q.denodeify(function (callback) {
			var profilePath = API.PATH.join(API.getTargetPath(), "profile");
			return API.FS.exists(profilePath, function (exists) {
				if (exists) return callback(null, profilePath);
				return API.FS.mkdirs(profilePath, function (err) {
					if (err) return callback(err);
					return callback(null, profilePath);
				});
			});
		})();
	}

	exports.resolve = function (resolver, config, previousResolvedConfig) {
		return resolver({}).then(function (resolvedConfig) {

			// TODO: Support multiple profiles.

			resolvedConfig.workingPath = API.getTargetPath() + ".working";
			if (!API.FS.existsSync(resolvedConfig.workingPath)) {
				API.FS.mkdirsSync(resolvedConfig.workingPath);
			}
			resolvedConfig.browserMappingKeyPath = "../../" + API.PATH.basename(API.getTargetPath()) + ".browsers";
			if (!API.FS.existsSync(API.getTargetPath() + ".browsers")) {
				API.FS.mkdirsSync(API.getTargetPath() + ".browsers");
			}

			return ensureProfilePath().then(function (profilePath) {

				// NOTE: 'resolvedConfig' gets MODIFIED by 'Profile' which is intentional.
				// TODO: Refactor this so the modification of 'resolvedConfig' is not a side-effect!
				var profile = new Profile(profilePath, resolvedConfig);

			}).then(function () {
				return resolvedConfig;
			});
		});
	}

	exports.turn = function (resolvedConfig) {
		// TODO: Support multiple profiles.
		return ensureProfilePath().then(function (profilePath) {
			// NOTE: 'resolvedConfig' gets MODIFIED by 'Profile' which is intentional.
			// TODO: Refactor this so the modification of 'resolvedConfig' is not a side-effect!
			var profile = new Profile(profilePath, resolvedConfig);
			return profile.init();
		});
	}

	exports.spin = function (resolvedConfig) {

console.log("SPIN pinf-to-mozilla-firefox-profile FOR:", API.getTargetPath());

		// TODO: Support multiple profiles.
		return ensureProfilePath().then(function (profilePath) {

			var profile = new Profile(profilePath, resolvedConfig);
			return profile.init().then(function() {
				return profile.start().then(function(process) {

					// TODO: Register with REPL and wait for kill signal.

				});
			});
		});
	}


	// @see http://kb.mozillazine.org/Command_line_arguments

	var Profile = function(profileBasePath, options) {
		this._profileBasePath = profileBasePath;
		this._options = options || {};

		this._process = null;

		this._options.browserVersion = this._options.browserVersion || DEFAULT_BROWSER_VERSION;

		this._workingPath = this._options.workingPath || process.cwd();

		var defaultPreferences = {
			"javascript.options.showInConsole": true,
			"nglayout.debug.disable_xul_cache": true,
			"browser.dom.window.dump.enabled":  true,
			"javascript.options.strict": true,
			"extensions.logging.enabled": true,
			"browser.tabs.warnOnClose": false,
			"browser.rights.3.shown": true,
			"browser.shell.checkDefaultBrowser": false,
			"extensions.autoDisableScopes": 0
	//		"devtools.debugger.log.verbose": true
	//		"devtools.dump.emit": true
		};
		this._options.preferences = this._options.preferences || {};
		for (var name in defaultPreferences) {
			if (typeof this._options.preferences[name] === "undefined") {
				this._options.preferences[name] = defaultPreferences[name];
			}
		}
		if (this._options.homepage) {
			this._options.preferences["browser.startup.homepage"] = this._options.homepage;
		}


		if (!this._profileBasePath) {
			var hash = CRYPTO.createHash("sha1");
		    hash.update(JSON.stringify(this._options));
			this._profileBasePath = API.PATH.join(this._workingPath, ".profiles", "firefox-" + hash.digest("hex").substring(0, 7));
		}
	}

	Profile.prototype.init = function() {
		var self = this;

		function ensureDescriptor() {

			var profileDescriptorPath = API.PATH.join(self._profileBasePath, "package.json");

			if (self._options.clean) {
				// TODO: Use async
				API.FS.removeSync(self._profileBasePath);
				API.FS.mkdirsSync(self._profileBasePath);
			}

			function updateMissing(descriptor, callback) {

				if (!descriptor.name) {
					descriptor.name = "io.devcomp.tool.firefox~profile";
				}

				if (!descriptor.config) {
					descriptor.config = {
				    	"smi.cli": {
					        "latestOnly": true
					    }
					};
				}
				if (!descriptor.config.profile) {
					descriptor.config.profile = {};
				}
				if (!descriptor.config.browser) {
					descriptor.config.browser = {};
				}

				if (typeof descriptor.config.profile.name === "undefined") {
					var date = new Date();
					descriptor.config.profile.name = self._options.name || [
						date.getUTCFullYear(),
						("0" + date.getUTCMonth()).replace(/^0?(\d{2})$/, "$1"),
						("0" + date.getUTCDate()).replace(/^0?(\d{2})$/, "$1"),
						"-",
						("0" + date.getUTCHours()).replace(/^0?(\d{2})$/, "$1"),
						("0" + date.getUTCMinutes()).replace(/^0?(\d{2})$/, "$1"),
						("0" + date.getUTCSeconds()).replace(/^0?(\d{2})$/, "$1")
					].join("");
				}

				if (typeof descriptor.config.browser.version === "undefined") {
					descriptor.config.browser.version = self._options.browserVersion;
				}

				var browserMappingKey = (self._options.browserMappingKeyPath || "../.browsers") + "/firefox-" + descriptor.config.browser.version;

				if (typeof descriptor.config.browser.installPath === "undefined") {
					descriptor.config.browser.installPath = self._options.browserInstallPath || API.PATH.join(self._profileBasePath, browserMappingKey);
				}

				// TODO: Look for other paths on other platforms.
				if (self._options.browserRelease === "nightly") {
					descriptor.config.browser.binPath = API.PATH.join(descriptor.config.browser.installPath, "FirefoxNightly.app/Contents/MacOS/firefox-bin");
				} else {
					descriptor.config.browser.binPath = API.PATH.join(descriptor.config.browser.installPath, "Firefox.app/Contents/MacOS/firefox-bin");
				}

				if (typeof descriptor.config.profile.workingPath === "undefined") {
					descriptor.config.profile.workingPath = self._workingPath;
				}

				if (!descriptor.mappings) {
					descriptor.mappings = {};
				}
				if (typeof descriptor.mappings[browserMappingKey + "[platform=darwin]"] === "undefined") {
					if (self._options.browserDownload) {
						descriptor.mappings[browserMappingKey + "[platform=darwin]"] = self._options.browserDownload;
					} else
					if (self._options.browserRelease === "nightly") {
						descriptor.mappings[browserMappingKey + "[platform=darwin]"] = "http://ftp.mozilla.org/pub/mozilla.org/firefox/nightly/latest-trunk/firefox-" + descriptor.config.browser.version + ".en-US.mac.dmg";
					} else {
						descriptor.mappings[browserMappingKey + "[platform=darwin]"] = "http://download.cdn.mozilla.net/pub/mozilla.org/firefox/releases/" + descriptor.config.browser.version + "/mac/en-US/Firefox%20" + descriptor.config.browser.version + ".dmg";
					}
				}
				var extensions = self._options.extensions || {};
				for (var id in extensions) {
					if (typeof descriptor.mappings["./extensions/" + id] === "undefined") {
						descriptor.mappings["./extensions/" + id] = {
							location: extensions[id],
							filelink: !/\.xpi$/.test(extensions[id]),
							copy: /\.xpi$/.test(extensions[id])
						}
					}
				}

				return callback(null, descriptor);
			}

			return API.Q.denodeify(function(callback) {
				return API.FS.exists(profileDescriptorPath, function(exists) {
					if (!exists) {
						return updateMissing({}, callback);
					}
					return API.FS.readJson(profileDescriptorPath, function(err, profile) {
						if (err) return callback(err);
						return updateMissing(profile, callback);
					});
				});
			})().then(function(descriptor) {
				return API.Q.denodeify(API.FS.outputFile)(profileDescriptorPath, JSON.stringify(descriptor, null, 4)).then(function() {
					return descriptor;
				});
			});
		}

		function ensureProfileCustomizations() {

			var path = API.PATH.join(self.getProfilePath(), "user.js");
			// TODO: Update preferences in existing file.
			if (!API.FS.existsSync(path)) {
				console.log("Writing profile config options to '" + path + "'");
				var preferencesJS = [];
				for (var name in self._options.preferences) {
					preferencesJS.push('user_pref("' + name + '", ' + JSON.stringify(self._options.preferences[name]) + ');');
				}
				API.FS.writeFileSync(path, preferencesJS.join("\n"));
			}

			var extensionsPath = API.PATH.join(self.getProfilePath(), "extensions");
			if (!API.FS.existsSync(extensionsPath)) {
				API.FS.mkdirsSync(extensionsPath);
			}

			return API.Q.resolve();
		}

		return ensureDescriptor().then(function(descriptor) {
			self._descriptor = descriptor;			
			return API.Q.denodeify(function(callback) {
				return SMI.install(self.getProfilePath(), API.PATH.join(self.getProfilePath(), "package.json"), {
					verbose: self._options.verbose || API.VERBOSE || false,
					debug: self._options.debug || API.DEBUG || false,
					latestOnly: true
				}, function(err, info) {
					if (err) return callback(err);

					return callback(null);
				});
			})();
		}).then(function() {
			return ensureProfileCustomizations();
		});
	}

	Profile.prototype.start = function() {
		var self = this;
		return API.Q.denodeify(function(callback) {
			if (self._process) {
				return self._process;
			}

			return API.runProgramProcess({
				label: API.getDeclaringPathId() + "/" + self._options.$to,
				commands: [
					[
						self.getBrowserBinPath(),
						"-profile", self.getProfilePath(),
						"-no-remote",
						"-jsconsole"
					].join(" ")
				],
				cwd: self.getWorkingPath()
			}, function (err, process) {
				if (err) return callback(err);
				return callback(null, (self._process = process));
			});


		    var proc = SPAWN(self.getBrowserBinPath(), [
				"-profile", self.getProfilePath(),
				"-no-remote",
				"-jsconsole"
			], {
				cwd: self.getWorkingPath()
			});
		    proc.on("error", function(err) {
		    	return callback(err);
		    });
	        proc.stdout.on("data", function(data) {
	            process.stdout.write(data);
	        });
	        proc.stderr.on("data", function(data) {
	            process.stderr.write(data);
	        });
		    proc.on("exit", function(code) {
		        if (code !== 0) {
		            console.error(new Error("Browser stopped with error!"));
		        }
		        console.log("Browser stopped!");
		    });
		    return callback(null, (self._process = proc));
		})();
	}

	Profile.prototype.stop = function() {
		var self = this;
		return API.Q.denodeify(function(callback) {
			if (!self._process) {
				return callback(null, null);
			}
			self._process.kill();
			// TODO: Wait for process to die.
			self._process = null;
			return callback(null, true);
		})();
	}

	Profile.prototype.getName = function() {
		return this._descriptor.config.profile.name;
	}

	Profile.prototype.getBrowserInstallPath = function() {
		return this._descriptor.config.browser.installPath;
	}

	Profile.prototype.getBrowserBinPath = function() {
		return this._descriptor.config.browser.binPath;
	}

	Profile.prototype.getProfilePath = function() {
		return this._profileBasePath;
	}

	Profile.prototype.getWorkingPath = function() {
		return this._descriptor.config.profile.workingPath;
	}


	return exports;
}
