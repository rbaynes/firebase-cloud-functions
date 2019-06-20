// Firebase cloud TypeScript (compiled to JS) function to
// recieve a POSTed public key from a device and insert the key into
// the Firestore document DB.

// For testing a local server:
// curl http://localhost:5000/fb-func-test/us-central1/saveKey  -H "Content-Type: application/json" -X POST --data '{"key": "rob", "cksum": "1", "MAC":"and cheese", "timestamp": "2018-12-04T15:52:52Z"}'

// For testing a deployed server:
// curl https://us-central1-fb-func-test.cloudfunctions.net/saveKey  -H "Content-Type: application/json" -X POST --data '{"key": "rob", "cksum": "1", "MAC":"and cheese", "timestamp": "2018-12-04T15:52:52Z"}'

// console:
// https://console.firebase.google.com/u/1/project/fb-func-test/functions/list


'use strict';

import * as functions from 'firebase-functions'
const firebase = require('firebase-admin');
const path = require('path');
const os = require('os');
const fs = require('fs');

const key_schema = {
  "properties": {
    "key": { "type": "string" },
    "cksum": { "type": "string" },
    "state": { "type": "string" },
    "MAC": { "type": "string" },
    "timestamp": { "type": "string" },
    "version": { "type": "string" }
  },
  "required": ["key", "cksum", "MAC"],
  "additionalProperties": false
};

const Ajv = require('ajv');
let ajv = new Ajv({allErrors: true});
const key_validate = ajv.compile( key_schema )


firebase.initializeApp({
    credential: firebase.credential.applicationDefault()
});

// view both in the firebase console 
// https://console.firebase.google.com/u/1/project/fb-func-test

// our doc DB collection 
var db = firebase.firestore();
var keys_db_ref = db.collection('devicePublicKeys');

// our file storage for images (this is the same as GCP storage)
var storage = firebase.storage();

// we are saving images to our openag-v1 google storage bucket with the name
// below.   view the bucket with this link:
// https://console.cloud.google.com/storage/browser/openag-public-image-uploads?project=openag-v1&organizationId=748412295656
//
const BUCKET_NAME = 'openag-public-image-uploads';
const BUCKET = 'gs://' + BUCKET_NAME;


//-----------------------------------------------------------------------------
// firebase cloud function to save an RSA public key
export const saveKey = functions.https.onRequest((request, response) => {
    if( request.method != 'POST' ) {
        response.status(403).json({error: "nope"}); // only POST allowed
    }

    // this uses the JSON data POSTed in the URL
    let doc = request.body;
    //console.log( 'Received:', doc );
    let isvalid = key_validate( doc );

    // add the state property
    doc.state = "unclaimed";

    // add doc to the DB
    if( isvalid ) {
        keys_db_ref.add( doc ).then( newdoc => {
            //console.log('Added document with ID: ', newdoc.id);
            response.json({ok: 'ok'});
        });
    } else {
        console.log( 'Invalid:' + ajv.errorsText(key_validate.errors));
        response.status(403).json({error: "nope"}); 
    }
});


//-----------------------------------------------------------------------------
// firebase cloud function to save an image
export const saveImage = functions.https.onRequest((request, response) => {
    if( request.method != 'POST' ) {
        response.status(403).json({error: "nope"}); 
    }

    // this uses the raw file data POSTed in the URL
    //console.log( 'request:', request );
    //console.log( 'request.body.length:', request.body.length );
    let file_contents = request.body;

    /* must remove the first bit of the uploade data, it is a header:
    --------------------------6717bd8e17e47c61^M
    Content-Disposition: form-data; name="data"; filename="EDU-43E028C7-c4-b3-01-8d-9b-8c"^M
    Content-Type: application/octet-stream^M
    ^M
    */

    let offset = 0; 
    while( offset < file_contents.length ) {
        let four_bytes = file_contents.readUInt32BE(offset);
        let four_byte_hex_str = four_bytes.toString(16);
        if( four_byte_hex_str == 'd0a0d0a' ) {
            offset += 4;
            break;
        }
        offset++;
    }
    //console.log( 'offset', offset );

    let header = String('');
    for( var i=0; i<offset; i++ ) {
        let h = file_contents.readUInt8(i);
        header += String.fromCharCode(h);
    }
    //console.log( 'header', header );

    // remove header and overwrite file contents Buffer
    file_contents = file_contents.slice(offset); 
    //console.log( 'new buffer length:', file_contents.length );

    // parse the file name from the header (in the filename field)
    let fn = header.indexOf("filename=");
    let fn_index_start = fn + "filename=\"".length;
    let fn_index_end = header.indexOf("\"", fn_index_start);
    let file_name = header.substring(fn_index_start, fn_index_end);
    //console.log( 'file_name', file_name );

    // parse the device ID from the start of the file_name
    let did_index_end = file_name.indexOf("_"); // finds first '_'
    let did = file_name.substring(0, did_index_end);
    //console.log( 'device_id', did );

    // save the file to gstorage
    // https://cloud.google.com/nodejs/docs/reference/storage/2.3.x/Bucket#file
    let bucket = storage.bucket(BUCKET); // GCP storage bucket (not firebase)
    let file = bucket.file(file_name);
    const metadata = {
        contentType: 'image/png',
        metadata: {
            device_id: did
        }
    };
    file.save(file_contents, metadata, function(err) {
        if(err) {
            console.log("Error saving image to gstorage:", file_name);
            response.status(403).json({error: "nope"}); 
        }
    });
    //console.log("Saved image to gstorage:", file_name);

    // done OK if we get here
    response.json({ok: 'ok'});
});

