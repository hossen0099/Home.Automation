var async = require("async");
var api = require("../api/");
var lib = require("../lib/");
var util = require("../lib/util");
var savedDevices = require("../config/devices.json");

setInterval(updateStatus, 1000 * 60 * 15);

var isUpdating = false;
var devices, io;

module.exports.devices = function(callback) {
	if (devices) {
		return callback(null, devices);
	} else {
		getDevices(function(err, results) {
			if (err) {
				return console.log(err);
			}

			devices = {};

			Object.keys(results.insteon).forEach(function(key) {
				var device = results.insteon[key];
				if (device.type == "switch" && device.enabled) {
					device.manufacturer = "insteon";
					devices[key] = device;
				}
			});

			Object.keys(results.lifx).forEach(function(key) {
				var device = results.lifx[key];
				if (device.enabled) {
					device.manufacturer = "lifx";
					devices[key] = device;
				}
			});

			Object.keys(results.thermostat).forEach(function(key) {
				var device = results.thermostat[key];
				device.manufacturer = "ecobee";
				device.current = {};
				devices[key] = device;
			});

			Object.keys(results.harmony).forEach(function(room) {
				var longRoom = room == "livingroom" ? "Living Room" : "Master Bedroom";
				var baseUrl = util.getHost() + "/harmony/hubs/" + room;

				var deviceId;
				var device = {
					"description": longRoom + " TV",
					"icon": savedDevices.harmony[room].icon,
					"group": longRoom,
					"type": "switch",
					"enabled": true,
					"onUrl": "",
					"offUrl": "",
					"toggle": "",
					"status": "unknown",
					"manufacturer": "harmony"
				};

				Object.keys(results.harmony[room].activities).forEach(function(id) {
					var activity = results.harmony[room].activities[id];
					device.hubName = room;
					deviceId = room;

					if (activity.name == "PowerOff") {
						device.offUrl = baseUrl + "/activities/" + id;
					} else if (activity.name.toLowerCase().indexOf("movie") > -1) {
						device.onUrl = baseUrl + "/activities/" + id;
						device.toggle = baseUrl + "/activities/" + id + "/toggle";
					}
				});

				devices[deviceId] = device;
			});

			//devices = results;
			return callback(err, devices);
		});
	}
};

module.exports.server = function(server) {
	if (!io) {
		io = server;
		updateStatus();
	}
};

module.exports.setStatus = function(id, status) {
	if (devices && devices.hasOwnProperty(id)) {
		devices[id].status = status;
		broadcastDevice({
			id: id,
			status: status
		});
	}
};

module.exports.broadcastDevices = broadcastDevices;
module.exports.updateStatus = updateStatus;

function broadcastDevice(obj) {
	io.sockets.emit('device', obj);
}

function broadcastDevices() {
	io.sockets.emit('devices', devices);
}

function updateStatus() {

	if (isUpdating || !devices) {
		return;
	}

	isUpdating = true;
	async.eachSeries(Object.keys(devices), function(key, next) {
		var device = devices[key];

		if (device.manufacturer == "insteon") {
			api.insteon.getStatusOfDevice(key, function(err, status) {
				devices[key].status = status;
				broadcastDevice({
					id: key,
					status: status
				});
				setTimeout(function() {
					next();
				}, 100);
			});
		}

		if (device.manufacturer == "lifx") {
			api.lifx.getStatusOfDevice(key, function(err, status) {
				if (err) {
					status = "offline";
				}

				devices[key].status = status;
				broadcastDevice({
					id: key,
					status: status
				});
				setTimeout(function() {
					next();
				}, 100);
			});
		}

		if (device.manufacturer == "harmony") {
			api.harmony.getStatusOfHub(device.hubName, function(err, status) {
				devices[key].status = status;
				broadcastDevice({
					id: key,
					status: status
				});

				setTimeout(function() {
					next();
				}, 100);
			});
		}
		if (device.manufacturer == "ecobee") {
			api.thermostat.getStatusOfDevice(key, function(err, status, thermostat) {
				devices[key].current = thermostat.current;
				devices[key].status = status;
				broadcastDevice({
					id: key,
					status: status
				});
				setTimeout(function() {
					next();
				}, 100);
			});
		}
	}, function(err) {
		console.log("================LOOPED");
		isUpdating = false;
	});

}

function getDevices(callback) {
	async.auto({
		insteon: function(next) {
			api.insteon.listDevices(function(err, devices) {
				next(err, devices);
			});
		},
		lifx: function(next) {
			api.lifx.listDevices(function(err, devices) {
				next(err, devices);
			});
		},
		thermostat: function(next) {
			var result = {};
			api.thermostat.list(function(err, devices) {
				next(err, devices);
			});
		},
		harmony: function(next) {
			var result = {};
			api.harmony.listHubs(function(hubs) {
				async.eachSeries(hubs, function(hub, nextHub) {
					api.harmony.listRoomCommands(hub, function(err, commands) {
						result[hub] = commands;
						nextHub();
					});
				}, function(err) {
					next(err, result);
				});
			});
		},
	}, function(err, results) {
		callback(err, results);
	});
}