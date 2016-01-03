#!/usr/bin/nodejs
/**
 * Created by Sig on 4/23/14.
 * Modified by Ghanashyam 
 */

var http = require('http');
var url = require('url');
var fs = require('fs');
var pathLib = require("path");
var gpio=require("pi-gpio");

var GpioPins = {};
var Commands;

GpioPins.TvPowerPin = 11;
GpioPins.WiFiRouterPowerPin = 12;
GpioPins.setTopBoxPowerPin = 13;
GpioPins.SoundSystemPowerPin = 15;
	
// fixme [gp] read on why this is required
var TimerThread = require('./js/TimerThread');

var commands_lookup = 
    { 'colours'    : ['KEY_1','KEY_2','KEY_0','KEY_SELECT'],
      'ndtv'       : ['KEY_5','KEY_0','KEY_3','KEY_SELECT'],
      'timesnow'   : ['KEY_5','KEY_0','KEY_7','KEY_SELECT'],
      'mtuneshd'   : ['KEY_6','KEY_6','KEY_6','KEY_SELECT'],
      'mtunes'     : ['KEY_6','KEY_6','KEY_5','KEY_SELECT'],
      'boxoff'     : ['KEY_POWEROFF'],
      'boxon'      : ['KEY_POWERON'],
      'volumedown' : ['KEY_VOLUMEUP'],
      'volumeup'   : ['KEY_VOLUMEDOWN'],
      'nextup'     : ['KEY_NEXT'],
      'previous'   : ['KEY_PREVIOUS'],
      };

var timer = new TimerThread();
var responseCache = undefined;
var requestCache = undefined;

//var board = new galileo();
var responseMaxRepeats = 200;
//var JSONStream = require('JSONStream');

var server = http.createServer(request);
var serverAddress = getIp('wlan0');
var serverPort = 8080;
var pin;
var pinstatus;
var value;

/*
 * Constants that can be use all through out the code
 */
const OFF = 0;
const ON  = 1;

/*
 * Initialize and start the http server
 */
server.listen(serverPort, getIp('wlan0'));
console.log('Web Server running at eth0 ' + serverAddress + ':'+ serverPort + ', wlan0 ' + getIp('wlan0') + ':' + serverPort);

/*
 * Initialize and start pin setup
 */
pinInit(ON);


// request and response handling 
function request( req, response ) {

    var command, path;
    responseCache = response;
    requestCache = req;
    command = "";
    console.log("request received");
    path = url.parse(req.url).pathname;
    console.log(path);

    // client would send the device name followed by ON/OFF to turn ON/OFF device
    if( path.indexOf("AllPowerPin")) {
        console.log(path);
        parseReq(path, response);
    }		
    else if( path.indexOf("setTopBoxPowerPin")) {
        parseReq(path, response);
    }		
    else if( path.indexOf("TvPowerPin")) {
        parseReq(path, response);
    }		
    else if( path.indexOf("WiFiRouterPowerPin")) {
        parseReq(path, response);
    }		
    else if( path.indexOf("SoundSystemPowerPin")) {
        parseReq(path, response);
    }		
    else if (path.indexOf("tatasky") === 1) {
	
        // treat as a REST request for arduino command, e.g. /arduino/analog/0)
        command = path.substring(9, path.length);
        console.log(command);
	    
	    writeCommand(command);
        responseCheck = 0;
	    // fixme [gp]
	    sendResponse(response, command);
    }
    else if (path.indexOf("galileo") == 1)
    {
	
	    // treat as a REST request for arduino command, e.g. /arduino/analog/0)
        command = path.substring(9, path.length);
        console.log(command);

	    // look IR commands up 
	    if (commands_lookup[command]){
	        Commands = commands_lookup[command];
	        Commands.forEach(RemoteCodeSend);
	    } else {
	        // response as 
	    }
	    sendResponse(response, command);
	
    }
    else {
        // serve a webpage
        serveHTML(response,path);
    }
}

/* 
 * fixme: gp (enhancement)
 * function to write response to mailbox file to pass commands to arduino sketch
 */
function writeCommand(command) {
    // delete any pending responses to make sure we get a fresh one
    try {
        fs.writeFileSync('/tmp/response', "none");
        //console.log("deleted OLD response");
    } catch(e) {
        console.log("writeCommand can't clear response");
    }
    
    try {
        fs.writeFileSync('/tmp/command', command);
    } catch(e) {
        console.log("writeCommand can't write command");
    }
     
    console.log('command: ' + command);
}

/*
 * function to use IRsend on Rasperry Pi - send IR commands through IR tx interface
 * on the Gpio
 */
function RemoteCodeSend(element, index, array){
    console.log('command['+ index + ']=' + element);
    sys_command_exec('irsend SEND_ONCE TATA_SKY' + element);
}

/*
 * function to send Response back to the client
 * fixme: gp : clearly define response handling for all the events
 */
function sendResponse(res, command) {
    var responseExists = false;
    var responseCheck = 0;
    var data = "";
    var dataStr;
    var dataParts;

    /* 
     * when file exists, get its contents and return to http request
     * if it takes too may tries to open file, give up
     */ 
    while(!responseExists && responseCheck < responseMaxRepeats) {
        try {
            data = fs.readFileSync('/tmp/response');
            dataStr = data + ""; // convert data to a string
            if (data != "none" && dataStr.indexOf("\n") >= 0) {
                responseExists = true;
            } else {
                responseCheck++;
            }
        } catch(e) {
            responseCheck++;
            console.log("file check: " + responseCheck);
        }
    }

    if (responseCheck >= responseMaxRepeats) {
        console.log("sendResponse tried too many times: " + responseCheck);
        res.writeHead(200, {'Content-Type': 'text/plain'});
	    res.end("response not received\n");
        res.end("");

    } else {

        res.writeHead(200, {'Content-Type': 'text/plain'});
        res.end(dataStr);
	    res.end("");

        try {
            fs.writeFileSync('/tmp/response', "none");
        } catch(e) {
            console.log("sendResponse can't clear response");
        }
    }
}

/*
 * fixme: gp: fix this for future enhancements
 * server an HTML page for web based control
 */ 
function serveHTML(response, path) {
    var filename = pathLib.join('/media/dev0/RPi/projects/mywebserver', path);
    var contentTypesByExtension = {
        '.html': "text/html",
        '.css':  "text/css",
        '.js':   "text/javascript",
        '.jpg':  "image/jpeg",
        '.png':  "image/png"
    };
    
    fs.exists(filename, function(exists) {
        if(!exists) {
            response.writeHead(404, {"Content-Type": "text/plain"});
            response.write("404 Not Found\n");
            response.end();
            return;
        }
	
        if (fs.statSync(filename).isDirectory()) filename += '/index.html';
	
        fs.readFile(filename, "binary", function(err, file) {
            if(err) {
                response.writeHead(500, {"Content-Type": "text/plain"});
                response.write(err + "\n");
                response.end();
                return;
            }
	    
            var headers = {};
            var contentType = contentTypesByExtension[pathLib.extname(filename)];
            if (contentType) headers["Content-Type"] = contentType;
            response.writeHead(200, headers);
            response.write(file, "binary");
            response.end();
        });
    });
    
}

/*
 * function to get the ip address on the network interface
 */ 
function getIp(interface) {
    try {
        var ips = require('os').networkInterfaces()[interface];
        var ip;
        ips.forEach(function(element) {
            if (element.family == "IPv4") {
                ip = element.address;
            }
        })
        return ip;
    } catch (e) {
        return "none";
    }
    
}

/*
 * fixme: gp: what is this? needs to be fixed
 * function to send response for the dummy requests
 */ 
function sendResponse_dummy(res, response_send){
    
    var responseExists = false;
    var responseCheck = 0;
    var data = "";
    var dataStr;
    var dataParts;
    
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end(response_send);
    res.end("");
    console.log("debug '" + response_send + "'");
    
}

/*
 * function to execute the system command
 */ 
function sys_command_exec(cmd, callback) 
{
    var sys = require('sys')
    var exec = require('child_process').exec;
 
    function puts(error, stdout, stderr) {
	//sys.puts(stdout);
	//console.log("debug:sys_command_exec:"+ stdout);	    
    }
    
    exec(cmd, puts);
    
}

/*
 * function to write to Gpio pin
 */ 
function pinWrite(pin,value) {

	// start with checking if there is already a direction 
	// set for the requested pin. 
	gpio.getDirection(pin, function(err, direction){
		
		/* error handling -
		 if there is no error, that means pin is already exported
		 if direction is set to input, just change it to output
		 if direction is set to output, then leave as is
		*/		  
		if(err){
		    /* 
		    try opening the pin with output mode
		    if success, then just write data to the pin
		    */		
		    try{
		    	gpio.open(pin,'output', function(err){ 
		    		if(err){
		    			console.log(err);
                        throw err;
		    		} else {
		    			gpio.write(pin, value, function(err){
		    				if(!err) {
		    					console.log('Write to pin '+ pin+ ' with a value: ' + value);
		    				} else { 
		    				// gp fix me
		    				// add some response back to the server here 	
		    				}
		    			});
		    		}
		    	});
		    }

		    /* 
		    catch the error 
		    fixme: add some response back to the server for error handling
		    */
		    catch (err){
		    	console.log('Error: Cannot open Gpio pin ' + pin);
		    }
        } else{
		    /*
		    check if the direction is set to input 
		    */
            console.log('Pin ' + pin + ' set to input, changing over mode to output');
            gpio.setDirection(pin,'output', function(err){
                    if(err) {
                            console.log(err);
                            throw err;
                    } else {
                            gpio.write(pin, value, function(err){
                                    if(!err){
                                            console.log('Write to pin ' + pin + ' with a value: ' + value);
                                    } else {
                                           // fixme: send response back to the server here
                                    }
                            });
                    }
            });
		}
	
    });
}

/*
 * function to set up the GPIO pins (initial setup)
 * All off configuration
 */
function pinInit(value) {

   /*
    * for all the Gpio pins in the associative array
    */
    Object.keys(GpioPins).forEach(function(key){
        pinWrite(GpioPins[key], value);
        console.log('Initializing Gpio Pin' + GpioPins[key] + ' with value '+ value);
    });
}

/*
 * function to parse http requests and process pinWrites
 */
function parseReq(reqPath, response) {

        var command;
	    var pinstatus;
        var pin, value;
    
        /*
         * parse pin value and status from the request
         */ 
        command = reqPath.substring(1,reqPath.length);
	    pinstatus = command.split('=');
        
        if(pinstatus[0] == 'AllPowerPin') {

            value = (pinstatus[1] == 'OFF');
            pinInit(value);
            
        } else {

	        pin = GpioPins[pinstatus[0]];
            value = (pinstatus[1] == 'OFF');
            pinWrite(pin, value);
        }

	    writeCommand(command);
        responseCheck = 0;
	    // fixme [gp]
        // write some response back to the client
	    sendResponse(response, command);
}
