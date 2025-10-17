import nodemailer from 'nodemailer';

export const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});
//Acá generaremos un nro aleatorio entre 100000 y 9000000 es decir, de 6 digitos
export const generateVerificationCode = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();

};

export const sendVerificationEmail = async (email, fullname, verificationCode) => {
    const mailOptions = {
        from: process.env.SMTP_USER,
        to: email,
        subject: 'Verificacion de cuenta - Confirma tu email',
        html: `
        <div style="max-width: 600px; margin 0 auto; font-family: Arial, sans-serif;">
            <div style= "background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding:30px; text-align:center;">
                <h1 style="color:white; margin:0;">¡Bienvenido/a!</h1>
            </div>
            <div style= "padding: 30px; background-color: #f9f9f9;">
                <h2 style="color: #333;">Hola ${fullname},</h2>
            <p style="color: #666; line_height: 1.6;">
                Gracias por registrarse en nuestra plataforma. Para completar tu registro, 
                necesitas verficar tu direccion de correo electronico.
            </p>
            <div style="text-align: center; margin: 30px 0;">
                <div style="background-color: #667eea; color: white; font-size:32px; font-weight:bold;
                padding: 15px 30px; border-radius:8px; display: inline-block; letter-spacing:3px;">
                ${verificationCode}
                </div>
            </div>
            <p style="color: #666; line-height:1.6;">
            Introduce este codigo en la app para activar la cuenta.
            <br><strong>Este codigo expira en 15 minutos.</strong>
            </p>
            </div>
            </div>
            `
    };

    try{
        const info = await transporter.sendMail(mailOptions);
        console.log("email enviado: ", info.messageId);
        return {success: true, messageId: info.messageId}; 
    }catch(error){
        console.error("Error enviando email", error);
        return {success: false, error: error.message};
    }
};
