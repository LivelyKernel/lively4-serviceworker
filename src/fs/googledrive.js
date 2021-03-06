/*
 * HTTP Google Drive access.
 */

import { Base, Stat, StatNotFoundError, File, FileNotFoundError, IsDirectoryError } from './base.js'
import * as util from '../util.js'

export default class Filesystem extends Base {
  constructor(path, options) {
    super('googledrive', path, options)

    if(options.token) {
      this.token = options.token
    } else {
      throw new Error("[googledrive] bearer auth token required")
    }

    if(options.subfolder) {
      this.subfolder = options.subfolder
      if (this.subfolder[0] != '/') {
        this.subfolder = '/' + this.subfolder
      }
    } else {
      this.subfolder = ''
    }
  }

  async stat(relativePath){
    let path = this.getGoogledrivePath(relativePath);
    let id = await this.googlePathToId(path);

    let response = await this.googleAPIFetch(`files?corpus=domain&q=%27`+id+`%27%20in%20parents`)

    util.responseOk(response, StatNotFoundError)

    let json  = await response.json()

    let items = json.items.map(item => ({
      "type": item.mimeType === 'application/vnd.google-apps.folder' && true ? "directory" : 'file',
        "name": item.title,
        "size": 0
      }))

    return Stat(true, items, ['GET', 'OPTIONS'])
  }

  async read(urlString) {
    let path = this.getGoogledrivePath(urlString);
    let id = await this.googlePathToId(path);
    let metadata_response = await this.googleAPIFetch(`files/`+id)

    util.responseOk(response, FileNotFoundError)

    let json  = await metadata_response.json()

    let m = json.mimeType.match(/application\/vnd.google-apps\.(.*)/)
    if(m) {
      // Need conversion for Google Document types
      let type = m[1]
      if (type == "spreadsheet") {
        return this.googleAPIFetch(`files/`+id + '/export?mimeType=text/csv');
      } else if (type == "drawing") {
        // #TODO svg+xml does not seem to work any more?
        // we can only display this (easily) when this code moves into the service worker
        return this.googleAPIFetch(`files/`+id + '/export?mimeType=application/pdf');
      } else {
        return this.googleAPIFetch(`files/`+id + '/export?mimeType=text/html');
      }
    } else {
      // download file
      return this.googleAPIFetch(`files/`+id + '?alt=media');
    }
  }

  async write(urlString, fileContent) {
  debugger
    var response;
    var data = await fileContent;
    var path = this.getGoogledrivePath(urlString);
    var id = await this.googlePathToId(path);
    if(!id) {
    var folderPath = path.replace(/\/[^\/]*$/,"");
    var fileName = path.replace(/.*\//,"")
    var folderId = await this.googlePathToId(folderPath);
    if (!folderId) {
      throw new Error(`Folder $(folderPath) does not exit`);
    }

    var delim = util.generateUuid()
    var body = `--${delim}
Content-Type: application/json; charset=UTF-8

{
  title: "${fileName}",
  parents: [
  {kind: "drive#folder", id: "${folderId}"}
  ]
}

--${delim}
Content-Type: text/plain; charset=UTF-8

`+data+`

--${delim}--`
    response = await fetch('https://www.googleapis.com/upload/drive/v2/files?uploadType=multipart', {
      method: 'POST',
      headers: new Headers({
        "Content-Type": "multipart/related; boundary=" + delim,
        Authorization: "Bearer " + this.token,
        "Content-Length": body.length
      }),
      body: body
    })
    } else {
    response = await this.googleAPIUpload(id, data);
    }

    if(response.status < 200 && response.status >= 300) {
      throw new Error(response.statusText)
    }

    return fileContent
  }

  getGoogledrivePath(relativePath) {
  return this.subfolder + decodeURIComponent(relativePath)
  }

  async googleAPIUpload(id, content, mimeType) {
  var headers = new Headers();
  headers.append('Authorization', 'Bearer ' + this.token)

  if (!mimeType)
    mimeType = (await (await this.googleAPIFetch('files/' + id )).json()).mimeType;

  headers.append('Content-Type', mimeType)

  return fetch('https://www.googleapis.com/upload/drive/v2/files/' + id + '?uploadType=media', {
      method: 'PUT',
      headers: headers,
      body: content
    })
  }

  async googleAPIFetch(string) {
  return  fetch(`https://www.googleapis.com/drive/v2/` + string, {
      method: 'GET',
      headers: new Headers({
        Authorization: "Bearer " + this.token
      }),
    })
  }



  async googlePathToId(path) {
  if(!path) { return undefined; }
  if(path === '/') { return 'root'; }

  var parentId ='root';
  path = path.replace(/^\//, '').split('/')
  while(path.length > 0 ) {
    let childName = path.shift();
    if(childName === '') { return parentId; }
    let childItem = await this.googleAPIFetch(`files?corpus=domain&q=%27`+ parentId+`%27%20in%20parents`)
    .then(r => r.json())
    .then(json => {
      return json.items.find(item => item.title === childName)
    });
    if(!childItem) { return undefined; } // file not found
    parentId = childItem.id;
  }
  return parentId;
  }



}
