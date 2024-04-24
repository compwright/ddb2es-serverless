.DEFAULT_GOAL := test

lint:
	node_modules/.bin/standard --fix src test

test: lint
	node_modules/.bin/mocha --timeout 20000 test

release: test
	node_modules/.bin/standard-version
