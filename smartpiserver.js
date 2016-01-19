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
var queryString = require("querystring");
var async=require("async");

/*
 * current working directory for creating response and command files 
 */
var cwd;
cwd = __dirname;
console.log('Retreiving current working directory for the script: ' + cwd);

/*
 * open files for intermediate use 
 */
var responseFile, commandFile;
responseFile = pathLib.join(cwd, 'response');
commandFile  = pathLib.join(cwd, 'command' );

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
var serverPort = 8081;
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
    var theUrl;

    responseCache = response;
    requestCache = req;
    command = "";

    // parse request received at the server
    parseReq(req, response);

}

/* 
 * fixme: gp (enhancement)
 * function to write response to mailbox file to pass commands to arduino sketch
 */
function writeCommand(command) {

    /* 
     * delete any pending responses to make sure we get a fresh one
     */
    try {
        fs.writeFileSync(responseFile, "success\n");
        //console.log("deleted OLD response");
    } catch(e) {
        console.log("Error: writeCommand can't clear response");
        console.log("Error: Response trying to write" + response);
    }
    
    /*
     * write the command to the command file 
     */ 
    try {
        fs.writeFileSync(commandFile, command);
    } catch(e) {
        console.log("Error: writeCommand can't write command");
        console.log('Error: Command trying to write: ' + command);
    }
     
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
function sendResponse(res, command, jsonObjList) {
    var responseExists = false;
    var responseCheck = 0;
    var data = "";
    var dataStr;
    var dataParts;
    var objectList = {};
    var json;


    /*
     * append objects to final return sequence
     */ 
    for (var key in jsonObjList) {
        objectList[key] = jsonObjList[key];
    }

    /* 
     * when file exists, get its contents and return to http request
     * if it takes too may tries to open file, give up
     */ 
    while(!responseExists && responseCheck < responseMaxRepeats) {
        try {
            data = fs.readFileSync(responseFile);
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

    /*
     * if response couldn't be synced up, then send FAIL as the json tag for login
     */ 
    if (responseCheck >= responseMaxRepeats) {
        console.log("sendResponse tried too many times: " + responseCheck);
        res.writeHead(200, {'Content-Type': 'application/json'});
        // update login status to FAIL if not able to respond
        objectList = {
            "login": "FAIL",
        };
        json = JSON.stringify(objectList);
        console.log('sending Failure response' + json);
        res.end(json);

    } else {

    /*
     * if we are able to sync response, then send SUCCESS as the JSON 
     */
        res.writeHead(200, {'Content-Type': 'application/json'});
        // update login status if response is available
        json = JSON.stringify(objectList);
        console.log('sending Successfull response' + json);
        res.end(json);
        try {
            fs.writeFileSync(responseFile, json);
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
 * function to read from a Gpio pin
 */
function pinRead(pin, callback) {

    // start with checking if there is already a direction set for the requested pin
    gpio.getDirection(pin, function(err, direction) {

        /*
         * error handling - 
         * If there is no error that mean pin is already exported and available
         * for read. 
         * If there is an error, then we have to export the pin and make it an
         * input pin
         */

        if(err) {
             //try opening the pin with output mode, if success, then just read the pin 
             console.log('Error while getting direction for pin' + pin);
             try {
                 gpio.open(pin, 'output', function (err) {

                     // if error, then couldn't open the pin as input at all
                     // give up here and throw err for catch  
                     if(err) {
                        throw(err);
                     } else {
                         // add in the call back function to process the err and the value
                         gpio.read(pin, function (err, value) {
                             callback(err, value);
                         });
                     }
                 });
             }

             // catch error while trying to open pin as input
             catch(err) {
                 console.log('Error: Could not open pin ' + pin + ' for reading, detailed error message as below');
                 console.log(err);
             }

        } else {

            // try changing pin direction to input and post a read request
            console.log('Direction of pin ' + pin + ' set to output but reading anyway');
            gpio.read(pin, function(err, value) {
                callback(err, value);
            });
        }
    });
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
		    	console.log('Error: Cannot open Gpio pin ' + pin + ' for a write');
		    }
        } else{
		    /*
		    check if the direction is set to input 
		    */
            if(direction == 'input') {
                
                console.log('Direction of pin ' + pin + ' is set to input, changing it to output for write');
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
            } else {

                gpio.write(pin, value, function(err){
                    if(!err){
                    console.log('Write to pin ' + pin + ' with a value: ' + value);
                    } else {
                    // fixme: send response back to the server here
                    }
                });

            }
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
function parseReq(req, response) {

        var command, pinstatus;
        var pin, value;
        var path, query, paramsValue;
        var objList = {};
            
        /*
         * parse pin value and status from the request
         * first check if these are login requests/status requests - will be in the form of query
         * or write requests for setting pin values
         */ 
        query = url.parse(req.url).query;
        paramsValue = queryString.parse(query);
        // initialize an empty response list

    
        console.log(url.parse(req.url).path);

        if(paramsValue['opcode'] === "login") {

            /*
             * create the json response with SUCCESS as the status if login query is received
             */ 
            writeCommand(command);
            responseCheck =0;
            objList['login'] = 'SUCCESS';
            sendResponse(response, command, objList);

        } else if (paramsValue['opcode'] === "status") {

            /*
             * this section will simply read and respond back with current GPIO pin status
             * of the raspberry Pi for each of the pins
             */
            var readItemsProcessed = 0;
            async.forEach(Object.keys(GpioPins), function (key, callback){ 

                pinRead(GpioPins[key], function (err, value) { 
                    if(value == 1) {
                        objList[key] = 'OFF';
                    } else {
                        objList[key] = 'ON';
                    }

                    readItemsProcessed++;
                    console.log('Read items processed' + readItemsProcessed);
                    if( readItemsProcessed === (Object.keys(GpioPins).length)) {
                        callback(); // tell async that the iterator has completed
                        writeCommand(command);
                        responseCheck =0;
                        objList['status'] = 'SUCCESS';
                        sendResponse(response, command, objList);
                        readItemsProcessed = 0;
                    }
                });

            });  

        } else if(paramsValue['opcode'] === 'write') {

            var writeItemsProcessed = 0;
            
            // check what GPIO pins were to be written by the params
            async.forEach(Object.keys(paramsValue), function (key, callback) {

                console.log('key: ' + key);
                console.log('paramsValue[key]: ' + paramsValue[key]);

                // check if the parameter is one of the Gpio pins
                if(GpioPins.hasOwnProperty(key)) {
                    writeCommand(command);
                    pinWrite(GpioPins[key], parseInt(paramsValue[key]));
                    callback();
                }

                writeItemsProcessed++;
                if( writeItemsProcessed === (Object.keys(paramsValue).length)) {
                   objList = {};
                   sendResponse(response, command, objList);
                   writeItemsProcessed = 0;
                }
            });
            
        }

}
