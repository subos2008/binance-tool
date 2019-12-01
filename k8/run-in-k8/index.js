const assert = require('assert');

// Configuration

// End Config

function fall_over(string) {
	console.log(`ERROR: ` + string);
	process.exit(1);
}

const fs = require('fs');
const Handlebars = require('handlebars');

const template_string = fs.readFileSync('template.handlebars', 'utf8');
const template = Handlebars.compile(template_string);

const YAML = require('yaml');
// const vars = YAML.parse(fs.readFileSync(process.env.VARS_INPUT_FILENAME, 'utf8'));
// const vault = YAML.parse(fs.readFileSync(process.env.VAULT_INPUT_FILENAME, 'utf8'));

function indent_cert(string) {
	return string.trim().split('\n').map((line) => `  ${line}`).join('\n');
}

const namespace = process.env.KUBECTL_NAMESPACE
const container_name = "binance-tool"
const job_name = "binance-tool-dev-job"
const docker_image = process.env.DOCKER_REGISTRY

const contents = template({
    docker_image,
    container_name
});

const output_dir = `deployed-trades`;
const execSync = require('child_process').execSync;
code = execSync(`mkdir -p ${output_dir}`);
const output_filename = `${output_dir}/${job_name}.yaml`;

fs.writeFileSync(output_filename, contents, (err) => {
    if (err) {
        return console.error(`Autsch! Failed to store template: ${err.message}.`);
    }
    console.log(`Saved ${output_filename}`);
});

code = execSync(`kubectl apply --namespace ${namespace} -f ${output_filename}`);

