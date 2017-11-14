import request from 'request';
import $ from 'cheerio';
import r from 'rethinkdb';
import init from 'rethinkdb-init';

const FACTS_PER_PAGE = 10;
const DB_NAME = 'factslides';
const connectionConfig = {
    host: 'localhost',
    port: 28015,
    pathname: '/',
    db: 'factslides'
};

init(r);
r
    .init(connectionConfig, ['facts'])
    .then(processPages)
    .then(done)
    .catch(processError);

function processPages(connection) {
    return determineLastPage(connection).then(lastPage => {
        if (lastPage < 2) done();
        const pages = [];
        for (let page = 2; page <= lastPage; page++) {
            pages
                .push(schedulePageProcessing(page)
                .then(storeFacts(connection))
                .then(pageProcessed(page)))
        }
        return Promise.all(pages)
    });
}

function determineLastPage(connection) {
    return r
        .table('facts')
        .max('id')
        .default({id: 0})
        .run(connection)
        .then(newestDbFact =>
            schedulePageProcessing(1).then(facts => {
                    let newestFactId = facts
                        .map(f => f.id)
                        .reduce((a, b) => Math.max(a, b));
                    let newestDbFactId = newestDbFact.id;
                    let lastPage = Math.ceil((newestFactId - newestDbFactId) / FACTS_PER_PAGE);
                    if (lastPage !== 0) {
                        storeFacts(connection)(facts)
                            .then(pageProcessed(1))
                            .catch(processError)
                    }
                    return lastPage;
                }
            )
        );
}

function schedulePageProcessing(pageNumber) {
    return processPage(`http://www.factslides.com/p-${pageNumber}`);
}

function processPage(url) {
    return new Promise((resolve, reject) =>
        request(url, (error, response, html) => {
            if (error) return reject(error);
            extractFacts($.load(html))
                .then(resolve)
                .catch(reject)
        }));
}

function extractFacts(document) {
    return new Promise((resolve, reject) => {
        try {
            const data = document('script')
                .filter((i, e) => 
                    $(e).text().trim().startsWith('// ---- var declarations')
                )
                .first()
                .text();
            const ids = extractArray(data, 'itemsID').slice(1);
            const texts = extractFactTexts(document);
            if (!(ids && texts)) return resolve([]);
            resolve(ids.map((id, i) => ({id: parseInt(id), text: texts[i]})));
        } catch (error) {
            reject(error);
        }
    });
}

function extractFactTexts($) {
    return $('#items .i')
        .not('#fe')
        .map((i, e) =>
            normalize($(e).text())
        )
        .get();
}

function extractArray(script, arrayName) {
    let match = new RegExp(`var ${arrayName}\\s*=\\s*(new Array\\(.+\\));`, 'g').exec(script);
    if (!match) return [];
    return eval(match[1]);
}

function normalize(factText) {
    return factText
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/\s(\.|,)/g, '$1');
}

function storeFacts(connection) {
    return facts => new Promise((resolve, reject) => {
        if (!facts) return resolve({});
        r
            .table('facts')
            .insert(facts)
            .run(connection, (error, result) => {
                if (error) return reject(error);
                resolve(result);
            });
    });
}

function done() {
    console.log('Done.');
    process.exit(0);
}

function processError(error) {
    console.error(error.msg ? error.msg : error);
    process.exit(1);
}

function pageProcessed(pageNumber) {
    return new Promise((resolve) => {
        console.log(`Page ${pageNumber} processed.`);
        resolve();
    });
}


